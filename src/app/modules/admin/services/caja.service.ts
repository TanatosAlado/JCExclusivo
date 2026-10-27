// caja.service.ts
import { Injectable } from '@angular/core';
import { Firestore, collection, query, where, getDocs, Timestamp, addDoc, collectionData, updateDoc, deleteDoc, doc, serverTimestamp } from '@angular/fire/firestore';
import { from, map, Observable } from 'rxjs';
import { Gasto } from '../models/gasto.model';
import { AuditoriaService } from 'src/app/shared/services/auditoria.service';
import { pagosDeVenta } from 'src/app/modules/despacho/services/pagos';

export interface Movimiento {
  id?: string;
  tipo: 'ingreso' | 'egreso';
  descripcion: string;
  monto: number;
  fecha: Date;
  origen?: 'web' | 'local' | 'gasto' | 'movimiento';
  tipoMovimiento?: string;   // ingreso | retiro | gasto | proveedor | deposito (movimientos de caja)
  metodoPago?: string;
  sucursalId?: string;
  observacion?: string;
  usuario?: string;          // quién registró el movimiento
  anulado?: boolean;         // los anulados se muestran pero no suman
  motivoAnulacion?: string;
  anuladoPor?: string;
  ventaId?: string;          // venta del local (una venta con varios medios genera un renglón por medio)
}

@Injectable({
  providedIn: 'root'
})
export class CajaService {

  // Colección donde se guardan los gastos (la misma que lee getEgresos)
  private gastosRef;
//   private cajasRef;
  
//    private readonly STORAGE_KEY = 'cajaActiva';

  constructor(private firestore: Firestore, private auditoria: AuditoriaService) {
    this.gastosRef = collection(this.firestore, 'gastos');
  }

//   async verificarCajaAbierta(sucursalId: string) {
//     const hoy = new Date();
//     const inicio = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 0, 0, 0);
//     const fin = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 23, 59, 59);

//     // 1) Query por rango (si fechaApertura está guardada como Timestamp)
//     try {
//       const q = query(
//         this.cajasRef,
//         where('sucursalId', '==', sucursalId),
//         where('fechaApertura', '>=', Timestamp.fromDate(inicio)),
//         where('fechaApertura', '<=', Timestamp.fromDate(fin)),
//         where('abierta', '==', true)
//       );

//       const snap = await getDocs(q);
//       if (!snap.empty) {
//         // por seguridad, retornamos el primer doc cuya fecha sea realmente de hoy
//         for (const docSnap of snap.docs) {
//           const data: any = docSnap.data();
//           if (this.esMismoDiaLocal(data.fechaApertura)) {
//             const caja = { id: docSnap.id, ...data };
//             this.setCajaActivaForLocal(caja); // sincronizar cache local
//             return caja;
//           }
//         }
//       }
//     } catch (err) {
//       // Es normal que falle si 'fechaApertura' está guardada como string o si falta índice.
//       console.warn('verificarCajaAbierta (query rango) falló:', err);
//     }

//     // 2) Fallback: buscar cajas abiertas para la sucursal (sin filtro de fecha) y verificar en JS
//     try {
//       const q2 = query(
//         this.cajasRef,
//         where('sucursalId', '==', sucursalId),
//         where('abierta', '==', true)
//       );
//       const snap2 = await getDocs(q2);
//       if (!snap2.empty) {
//         for (const docSnap of snap2.docs) {
//           const data: any = docSnap.data();
//           if (this.esMismoDiaLocal(data.fechaApertura)) {
//             const caja = { id: docSnap.id, ...data };
//             this.setCajaActivaForLocal(caja);
//             return caja;
//           }
//         }
//       }
//     } catch (err) {
//       console.warn('verificarCajaAbierta (fallback) falló:', err);
//     }

//     // No hay caja abierta válida para HOY
//     this.clearCajaActiva();
//     return null;
//   }

getIngresos(fechaInicio: Date, fechaFin: Date) {

  const pedidosRef = collection(this.firestore, 'Pedidos Finalizados');

  return from(getDocs(pedidosRef)).pipe(
    map(snapshot => {
      const docs = snapshot.docs.map(doc => {
        const data: any = doc.data();

        const fecha = data.fecha ? this.parseFecha(data.fecha) : null;

        return <Movimiento>{
          id: doc.id,
          tipo: 'ingreso',
          descripcion: `Pedido web #${data.nroPedido} - ${data.nombreCliente} ${data.apellidoCliente}`.trim(),
          monto: data.total ?? 0,
          fecha,
          origen: 'web',
          metodoPago: (data.pago || '').toLowerCase()
        };
      });

      return docs.filter(m =>
        m.fecha &&
        m.fecha >= fechaInicio &&
        m.fecha <= fechaFin
      );
    })
  );
}

/**
 * Ventas hechas en el local (Despacho), colección 'Ventas'.
 * La fecha se guarda como ISO (UTC), por eso se filtra con el rango en ISO.
 */
getIngresosLocal(fechaInicio: Date, fechaFin: Date) {

  const ventasRef = collection(this.firestore, 'Ventas');
  const q = query(
    ventasRef,
    where('fecha', '>=', fechaInicio.toISOString()),
    where('fecha', '<=', fechaFin.toISOString())
  );

  return from(getDocs(q)).pipe(
    map(snapshot =>
      snapshot.docs.flatMap(docSnap => {
        const data: any = docSnap.data();
        const cliente = data.cliente?.nombre || 'Consumidor final';
        const lista = data.tipoPrecio === 'mayorista' ? ' (mayorista)' : '';
        const esReparacion = data.tipoVenta === 'reparacion';
        const ticket = data.nroTicket ? ` · Ticket ${String(data.nroTicket).padStart(8, '0')}` : '';
        const descripcion = (esReparacion
          ? `Cobro reparación orden #${data.orden?.numeroOrden ?? '?'} - ${cliente}`
          : `Venta local - ${cliente}${lista}`) + ticket;

        // Pagada con varios medios → un renglón por medio (así cuadran los totales por medio de pago)
        const pagos = pagosDeVenta(data);
        return pagos.map((pago, i) => <Movimiento>{
          id: docSnap.id,
          ventaId: docSnap.id,
          tipo: 'ingreso',
          descripcion: pagos.length > 1 ? `${descripcion} (pago ${i + 1} de ${pagos.length})` : descripcion,
          monto: pago.monto,
          fecha: new Date(data.fecha),
          origen: 'local',
          metodoPago: pago.metodo === 'otros' ? (data.metodoPago || '').toLowerCase() : pago.metodo,
          sucursalId: data.sucursalId,
          usuario: data.usuario?.usuario || '',
          anulado: data.anulada === true,
          motivoAnulacion: data.motivoAnulacion || '',
          anuladoPor: data.anuladaPor?.usuario || ''
        });
      })
    )
  );
}

// // Función auxiliar (afuera de la clase)
parseFecha(fechaStr: string): Date {
  const [fechaPart, horaPart] = fechaStr.split(' ');
  const [dia, mes, anio] = fechaPart.split('/').map(Number);
  const [hora, minuto] = horaPart.split(':').map(Number);
  return new Date(anio, mes - 1, dia, hora, minuto);
}

  // 🔹 Obtener egresos (gastos cargados)
  getEgresos(fechaInicio: Date, fechaFin: Date) {
    const gastosRef = collection(this.firestore, 'gastos');
    const q = query(
      gastosRef,
      where('fecha', '>=', Timestamp.fromDate(fechaInicio)),
      where('fecha', '<=', Timestamp.fromDate(fechaFin))
    );

    return from(getDocs(q)).pipe(
      map(snapshot =>
        snapshot.docs.map(doc => {
          const data: any = doc.data();
          return <Movimiento>{
            id: doc.id,
            tipo: 'egreso',
            descripcion: data.concepto ?? data.descripcion ?? 'Gasto',
            monto: Number(data.monto) || 0,
            fecha: data.fecha.toDate(),
            origen: 'gasto',
            observacion: data.observacion || '',
            usuario: data.usuario?.usuario || '',
            anulado: data.anulado === true,
            motivoAnulacion: data.motivoAnulacion || '',
            anuladoPor: data.anuladoPor?.usuario || ''
          };
        })
      )
    );
  }

  /** Registrar un gasto (egreso de caja) */
  async agregarGasto(gasto: Gasto) {
    const usuario = this.auditoria.getUsuarioActual();
    const datos = {
      fecha: Timestamp.fromDate(gasto.fecha),
      concepto: gasto.concepto.trim(),
      monto: Number(gasto.monto),
      observacion: (gasto.observacion || '').trim(),
      creadoEn: serverTimestamp(),
      usuario: usuario || null,
      anulado: false
    };
    const docRef = await addDoc(this.gastosRef, datos);

    this.auditoria.registrar({
      accion: 'crear',
      entidad: 'gastos',
      entidadId: docRef.id,
      descripcion: `Cargó el gasto "${datos.concepto}" por $${datos.monto}`,
      despues: { concepto: datos.concepto, monto: datos.monto, observacion: datos.observacion, fecha: gasto.fecha.toISOString() }
    });

    return docRef;
  }

  /**
   * Anular un gasto cargado por error.
   * NO se borra: queda marcado como anulado, con motivo, usuario y fecha (trazabilidad).
   */
  async anularGasto(id: string, motivo: string) {
    const usuario = this.auditoria.getUsuarioActual();
    const antes = await this.auditoria.capturar('gastos', id);
    const cambios = {
      anulado: true,
      motivoAnulacion: motivo.trim(),
      anuladoPor: usuario || null,
      anuladoEn: serverTimestamp()
    };
    await updateDoc(doc(this.firestore, 'gastos', id), cambios);

    this.auditoria.registrar({
      accion: 'anular',
      entidad: 'gastos',
      entidadId: id,
      descripcion: `Anuló el gasto "${antes?.concepto || id}" por $${antes?.monto ?? '?'}. Motivo: ${motivo.trim()}`,
      antes: { anulado: antes?.anulado ?? false },
      despues: { anulado: true, motivoAnulacion: motivo.trim() }
    });
  }

// agregarGasto(gasto: Gasto) {
//     const nuevoGasto = {
//       ...gasto,
//       creadoEn: new Date(),
//       actualizadoEn: new Date()
//     };
//     return addDoc(this.gastosRef, nuevoGasto);
//   }

//   obtenerGastos(): Observable<Gasto[]> {
//     return collectionData(this.gastosRef, { idField: 'id' }) as Observable<Gasto[]>;
//   }

//   actualizarGasto(id: string, gasto: Partial<Gasto>) {
//     const gastoDoc = doc(this.firestore, `Gastos/${id}`);
//     return updateDoc(gastoDoc, { ...gasto, actualizadoEn: new Date() });
//   }

//   eliminarGasto(id: string) {
//     const gastoDoc = doc(this.firestore, `Gastos/${id}`);
//     return deleteDoc(gastoDoc);
//   }



//   /** Abrir nueva caja */
//   async abrirCaja(sucursalId: string, usuarioId: string, montoInicial: number) {
//     const ahora = new Date();
//     const nuevaCaja = {
//       sucursalId,
//       usuarioId,
//       montoInicial,
//       fechaApertura: Timestamp.fromDate(ahora), // guardamos Timestamp (recomendado)
//       abierta: true
//     };
//     const docRef = await addDoc(this.cajasRef, nuevaCaja);
//     const cajaConId = { id: docRef.id, ...nuevaCaja };
//     // Guardamos en localStorage una representación serializable (ISO) para el fallback offline
//     this.setCajaActivaForLocal({
//       ...cajaConId,
//       fechaApertura: ahora.toISOString()
//     });
//     return cajaConId;
//   }

//     private setCajaActivaForLocal(caja: any) {
//     const toStore = {
//       ...caja,
//       // si viene como Timestamp, convertimos a ISO; si ya es string lo dejamos
//       fechaApertura: (caja.fechaApertura && typeof caja.fechaApertura.toDate === 'function')
//         ? caja.fechaApertura.toDate().toISOString()
//         : (typeof caja.fechaApertura === 'string' ? caja.fechaApertura : new Date().toISOString())
//     };
//     localStorage.setItem(this.STORAGE_KEY, JSON.stringify(toStore));
//   }

//   getCajaActivaForLocal(): any | null {
//     const raw = localStorage.getItem(this.STORAGE_KEY);
//     return raw ? JSON.parse(raw) : null;
//   }


//   /** Persistencia local */
//   setCajaActiva(caja: any) {
//     localStorage.setItem('cajaActiva', JSON.stringify(caja));
//   }
//   getCajaActiva() {
//     const raw = localStorage.getItem('cajaActiva');
//     return raw ? JSON.parse(raw) : null;
//   }

// /** Normaliza distintos tipos de fecha y dice si la fecha corresponde a hoy */
// private esMismoDiaLocal(fechaAny: any): boolean {
//   if (!fechaAny) return false;
//   let d: Date;
//   // Firestore Timestamp (tiene toDate)
//   if (fechaAny && typeof fechaAny.toDate === 'function') {
//     d = fechaAny.toDate();
//   } else if (fechaAny && typeof fechaAny.seconds === 'number') {
//     d = new Date(fechaAny.seconds * 1000);
//   } else if (typeof fechaAny === 'string') {
//     d = new Date(fechaAny);
//   } else if (fechaAny instanceof Date) {
//     d = fechaAny;
//   } else {
//     d = new Date(fechaAny);
//   }
//   if (isNaN(d.getTime())) return false;
//   const now = new Date();
//   return d.getFullYear() === now.getFullYear()
//     && d.getMonth() === now.getMonth()
//     && d.getDate() === now.getDate();
// }

// /**
//  * Devuelve la caja guardada en localStorage sólo si es de hoy.
//  * - Si no existe o no es de hoy, la borra y devuelve null.
//  */
// getCajaActivaLocalValidada(): any | null {
//   const raw = localStorage.getItem(this.STORAGE_KEY);
//   if (!raw) return null;
//   try {
//     const caja = JSON.parse(raw);
//     if (this.esMismoDiaLocal(caja.fechaApertura)) {
//       return caja;
//     } else {
//       // si la fecha NO es de hoy, limpiamos la cache local
//       this.clearCajaActiva();
//       return null;
//     }
//   } catch (err) {
//     // si no se puede parsear, limpiamos por seguridad
//     this.clearCajaActiva();
//     return null;
//   }
// }

// /** Borrar la caja local (ya lo tenías, asegúrate que usa STORAGE_KEY) */
// clearCajaActiva() {
//   localStorage.removeItem(this.STORAGE_KEY);
// }

}