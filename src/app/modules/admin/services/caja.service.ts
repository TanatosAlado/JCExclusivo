// caja.service.ts
import { Injectable } from '@angular/core';
import { Firestore, collection, query, where, getDocs, Timestamp, addDoc, collectionData, updateDoc, deleteDoc, doc } from '@angular/fire/firestore';
import { from, map, Observable } from 'rxjs';
import { Gasto } from '../models/gasto.model';

export interface Movimiento {
  id?: string;
  tipo: 'ingreso' | 'egreso';
  descripcion: string;
  monto: number;
  fecha: Date;
}

@Injectable({
  providedIn: 'root'
})
export class CajaService {

   private gastosRef;
//   private cajasRef;
  
//    private readonly STORAGE_KEY = 'cajaActiva';

  constructor(private firestore: Firestore) {
    this.gastosRef = collection(this.firestore, 'Gastos');
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
  console.log('getIngresos called with:', fechaInicio, fechaFin);

  const pedidosRef = collection(this.firestore, 'Pedidos Finalizados');

  return from(getDocs(pedidosRef)).pipe(
    map(snapshot => {
      const docs = snapshot.docs.map(doc => {
        const data: any = doc.data();

        const fecha = data.fecha ? this.parseFecha(data.fecha) : null;

        return <Movimiento>{
          id: doc.id,
          tipo: 'ingreso',
          descripcion: `Pedido #${data.nroPedido} - ${data.nombreCliente} ${data.apellidoCliente}`,
          monto: data.total ?? 0,
          fecha
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
            descripcion: data.descripcion ?? 'Gasto',
            monto: data.monto ?? 0,
            fecha: data.fecha.toDate()
          };
        })
      )
    );
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