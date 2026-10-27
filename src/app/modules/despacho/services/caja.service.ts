import { Injectable } from '@angular/core';
import { Firestore, collection, query, where, getDocs, addDoc, doc, runTransaction, serverTimestamp } from '@angular/fire/firestore';
import { AuditoriaService, UsuarioRegistro } from 'src/app/shared/services/auditoria.service';
import { pagosDeVenta } from './pagos';

/** Totales de una caja (se calculan a partir de sus ventas) */
export interface ResumenCaja {
  montoInicial: number;
  cantidadVentas: number;        // ventas vigentes
  cantidadAnuladas: number;      // ventas anuladas (no suman)
  totalVendido: number;
  porMetodo: { efectivo: number; tarjeta: number; transferencia: number; otros: number };
  movimientos: {                 // movimientos de efectivo vigentes (no anulados)
    ingresos: number;
    retiros: number;
    gastos: number;
    proveedores: number;
    depositos: number;
    cantidad: number;
  };
  efectivoEsperado: number;      // inicial + ventas efectivo + ingresos - retiros - gastos - proveedores - depósitos
  documentosVentas: number;      // total de ventas registradas (control de concurrencia)
  operacionesMovimientos: number; // altas + anulaciones de movimientos (control de concurrencia)
}

/** Datos del cierre que quedan guardados en la caja */
export interface CierreCaja {
  resumen: ResumenCaja;
  efectivoContado: number;
  diferencia: number;            // contado - esperado
  resultado: 'exacto' | 'sobrante' | 'faltante';
  observacion: string;
  detalleBilletes?: { [denominacion: string]: number } | null;
  administrativo?: boolean;      // cerrada por un administrador sin conteo real (cajas viejas)
}

/** Error de negocio con mensaje para mostrar */
export class CierreCajaError extends Error {
  constructor(message: string) {
    super(message);
  }
}

@Injectable({ providedIn: 'root' })
export class CajaService {
  private readonly STORAGE_KEY = 'cajaActiva';

  constructor(private firestore: Firestore, private auditoria: AuditoriaService) {}

  /** Obtener caja activa de localStorage */
  getCajaActiva(): any | null {
    const data = localStorage.getItem(this.STORAGE_KEY);
    return data ? JSON.parse(data) : null;
  }

  /** Guardar caja activa en localStorage */
  setCajaActiva(caja: any) {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(caja));
  }

  /** Limpiar caja activa (al cerrar) */
  clearCajaActiva() {
    localStorage.removeItem(this.STORAGE_KEY);
  }

  // /** Verificar en Firestore si hay una caja abierta para la sucursal */
  // async verificarCajaAbierta(sucursalId: string) {
  //   const cajasRef = collection(this.firestore, 'Cajas');
  //   const q = query(cajasRef, where('sucursalId', '==', sucursalId), where('abierta', '==', true));
  //   const snap = await getDocs(q);

  //   if (!snap.empty) {
  //     const caja = { id: snap.docs[0].id, ...snap.docs[0].data() };
  //     this.setCajaActiva(caja); // sincronizar en local
  //     return caja;
  //   }

  //   this.clearCajaActiva();
  //   return null;
  // }

  /**
   * Busca la caja abierta de HOY (día local de Argentina) para la sucursal.
   * Antes se comparaba contra la fecha en UTC: desde las 21 hs ya era "mañana"
   * y no encontraba la caja (y tampoco dejaba abrir otra).
   */
  async verificarCajaAbierta(sucursalId: string) {
  const cajasRef = collection(this.firestore, 'Cajas');
  const q = query(
    cajasRef,
    where('sucursalId', '==', sucursalId),
    where('abierta', '==', true)
  );

  const snap = await getDocs(q);

  if (!snap.empty) {
    // buscamos si alguna caja tiene la fechaApertura de HOY (hora local)
    const cajaHoy = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .find(caja => this.esMismoDiaLocal((caja as any).fechaApertura));

    if (cajaHoy) {
      this.setCajaActiva(cajaHoy); // la dejamos guardada para la sesión
      return cajaHoy;
    }
  }

  //console.log("❌ Caja cerrada");
  return null;
}

  /**
   * Cajas que quedaron ABIERTAS de días anteriores (nadie las cerró).
   * Hay que cerrarlas antes de abrir la caja de hoy.
   */
  async buscarCajasSinCerrar(sucursalId: string): Promise<any[]> {
    const q = query(
      collection(this.firestore, 'Cajas'),
      where('sucursalId', '==', sucursalId),
      where('abierta', '==', true)
    );
    const snap = await getDocs(q);
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() } as any))
      .filter(caja => !this.esMismoDiaLocal(caja.fechaApertura))
      .sort((a, b) => String(a.fechaApertura).localeCompare(String(b.fechaApertura)));
  }

  /** Todas las cajas abiertas de días anteriores, de todas las sucursales */
  async buscarTodasLasCajasSinCerrar(): Promise<any[]> {
    const snap = await getDocs(query(
      collection(this.firestore, 'Cajas'),
      where('abierta', '==', true)
    ));
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() } as any))
      .filter(caja => !this.esMismoDiaLocal(caja.fechaApertura))
      .sort((a, b) => String(a.fechaApertura).localeCompare(String(b.fechaApertura)));
  }

  /**
   * Cierre administrativo de una caja vieja: se toma el efectivo contado = esperado
   * (sin diferencias) y queda marcado como "administrativo" para distinguirlo de un
   * cierre con conteo real.
   */
  async cerrarCajaAdministrativa(caja: any, motivo: string): Promise<any> {
    const resumen = await this.obtenerResumen(caja);
    return this.cerrarCaja(caja, resumen, resumen.efectivoEsperado, motivo, null, { administrativo: true });
  }

  /** Abrir caja */
  async abrirCaja(sucursalId: string, usuario: UsuarioRegistro | null, montoInicial: number) {
    if (!usuario) {
      throw new Error('No se pudo identificar al usuario. Volvé a iniciar sesión.');
    }

    const hoy = new Date();
    const cajasRef = collection(this.firestore, 'Cajas');

    // 1) No puede haber dos cajas ABIERTAS a la vez en la sucursal.
    //    (Si la de hoy ya se cerró, se puede abrir otra: por ejemplo, turno tarde.)
    const abiertas = await getDocs(query(
      cajasRef,
      where('sucursalId', '==', sucursalId),
      where('abierta', '==', true)
    ));
    if (!abiertas.empty) {
      const hayDeHoy = abiertas.docs.some(d => this.esMismoDiaLocal((d.data() as any).fechaApertura));
      throw new Error(hayDeHoy
        ? 'Ya hay una caja abierta hoy para esta sucursal.'
        : 'Hay una caja de un día anterior sin cerrar. Cerrala antes de abrir una nueva.');
    }

    // 2) Crear caja
    const nuevaCaja = {
      sucursalId,
      usuarioId: usuario.uid,  // quién abrió la caja
      usuario,                 // { uid, usuario, nombre }
      montoInicial,
      fechaApertura: hoy.toISOString(),
      abierta: true,
      cantidadVentas: 0,       // contador que actualiza cada venta (control al cerrar)
      cantidadMovimientos: 0,  // ídem para los movimientos de efectivo
      cantidadAnulaciones: 0   // ídem para los tickets anulados
    };

    const docRef = await addDoc(cajasRef, nuevaCaja);

    // Devolvemos los DATOS de la caja (antes se devolvía solo la referencia,
    // sin sucursalId, y la primera venta después de abrir fallaba)
    const cajaCreada = { id: docRef.id, ...nuevaCaja };
    this.setCajaActiva(cajaCreada);

    this.auditoria.registrar({
      accion: 'abrir caja',
      entidad: 'Cajas',
      entidadId: docRef.id,
      descripcion: `Abrió la caja con $${montoInicial} de monto inicial`,
      extra: { sucursalId, montoInicial }
    });

    return cajaCreada;
  }

  // =====================================================
  // CIERRE DE CAJA
  // =====================================================

  /** Calcula los totales de una caja a partir de sus ventas */
  async obtenerResumen(caja: any): Promise<ResumenCaja> {
    const [snap, snapMov] = await Promise.all([
      getDocs(query(collection(this.firestore, 'Ventas'), where('cajaId', '==', caja.id))),
      getDocs(query(collection(this.firestore, 'MovimientosCaja'), where('cajaId', '==', caja.id)))
    ]);

    // Movimientos de efectivo
    const movimientos = { ingresos: 0, retiros: 0, gastos: 0, proveedores: 0, depositos: 0, cantidad: 0 };
    let operacionesMovimientos = 0;
    for (const d of snapMov.docs) {
      const mov: any = d.data();
      operacionesMovimientos++;                 // alta
      if (mov.anulado === true) {
        operacionesMovimientos++;               // anulación
        continue;
      }
      const importe = Number(mov.importe) || 0;
      movimientos.cantidad++;
      if (mov.tipo === 'ingreso') movimientos.ingresos += importe;
      else if (mov.tipo === 'retiro') movimientos.retiros += importe;
      else if (mov.tipo === 'gasto') movimientos.gastos += importe;
      else if (mov.tipo === 'proveedor') movimientos.proveedores += importe;
      else if (mov.tipo === 'deposito') movimientos.depositos += importe;
    }

    const porMetodo = { efectivo: 0, tarjeta: 0, transferencia: 0, otros: 0 };
    let cantidadVentas = 0;
    let cantidadAnuladas = 0;
    let totalVendido = 0;

    for (const d of snap.docs) {
      const venta: any = d.data();
      if (venta.anulada === true) {
        cantidadAnuladas++;
        continue;
      }
      const monto = Number(venta.total) || 0;
      cantidadVentas++;
      totalVendido += monto;

      // Una venta puede pagarse con varios medios: cada parte suma a su medio
      for (const pago of pagosDeVenta(venta)) {
        porMetodo[pago.metodo] += pago.monto;
      }
    }

    const montoInicial = Number(caja.montoInicial) || 0;

    return {
      montoInicial,
      cantidadVentas,
      cantidadAnuladas,
      totalVendido: this.redondear(totalVendido),
      porMetodo: {
        efectivo: this.redondear(porMetodo.efectivo),
        tarjeta: this.redondear(porMetodo.tarjeta),
        transferencia: this.redondear(porMetodo.transferencia),
        otros: this.redondear(porMetodo.otros)
      },
      movimientos: {
        ingresos: this.redondear(movimientos.ingresos),
        retiros: this.redondear(movimientos.retiros),
        gastos: this.redondear(movimientos.gastos),
        proveedores: this.redondear(movimientos.proveedores),
        depositos: this.redondear(movimientos.depositos),
        cantidad: movimientos.cantidad
      },
      efectivoEsperado: this.redondear(
        montoInicial + porMetodo.efectivo + movimientos.ingresos
        - movimientos.retiros - movimientos.gastos - movimientos.proveedores - movimientos.depositos
      ),
      documentosVentas: snap.size,
      operacionesMovimientos
    };
  }

  /**
   * Cierra la caja en una transacción:
   *  - verifica que siga abierta (que nadie la haya cerrado antes),
   *  - verifica que no se haya registrado una venta mientras se hacía el conteo,
   *  - guarda el cierre (esperado, contado, diferencia, quién y cuándo),
   *  - deja el registro de auditoría.
   * Una caja cerrada ya no se puede modificar (lo garantizan las reglas de Firestore).
   */
  async cerrarCaja(
    caja: any,
    resumen: ResumenCaja,
    efectivoContado: number,
    observacion: string,
    detalleBilletes?: { [denominacion: string]: number } | null,
    opciones?: { administrativo?: boolean }
  ): Promise<any> {

    const usuario = this.auditoria.getUsuarioActual();
    if (!usuario) {
      throw new CierreCajaError('No se pudo identificar al usuario. Volvé a iniciar sesión.');
    }

    const contado = this.redondear(Number(efectivoContado) || 0);
    const diferencia = this.redondear(contado - resumen.efectivoEsperado);
    const resultado: CierreCaja['resultado'] =
      Math.abs(diferencia) < 0.01 ? 'exacto' : (diferencia > 0 ? 'sobrante' : 'faltante');

    const cierre: CierreCaja = {
      resumen,
      efectivoContado: contado,
      diferencia,
      resultado,
      observacion: (observacion || '').trim(),
      detalleBilletes: detalleBilletes || null,
      administrativo: opciones?.administrativo === true
    };

    const fechaCierre = new Date().toISOString();
    const cajaRef = doc(this.firestore, 'Cajas', caja.id);

    const textoResultado = resultado === 'exacto'
      ? 'sin diferencias'
      : `${resultado} de $${Math.abs(diferencia).toFixed(2)}`;

    const registro = await this.auditoria.armarRegistro({
      accion: 'cerrar caja',
      entidad: 'Cajas',
      entidadId: caja.id,
      descripcion: opciones?.administrativo
        ? `Cierre administrativo de la caja del ${new Date(caja.fechaApertura).toLocaleDateString('es-AR')} (sin conteo, esperado $${resumen.efectivoEsperado.toFixed(2)})`
        : `Cerró la caja: esperado $${resumen.efectivoEsperado.toFixed(2)}, contado $${contado.toFixed(2)} (${textoResultado})`,
      extra: {
        sucursalId: caja.sucursalId,
        ventas: resumen.cantidadVentas,
        totalVendido: resumen.totalVendido,
        efectivoEsperado: resumen.efectivoEsperado,
        efectivoContado: contado,
        diferencia,
        observacion: cierre.observacion
      }
    });

    await runTransaction(this.firestore, async (tx) => {
      const snap = await tx.get(cajaRef);
      if (!snap.exists()) {
        throw new CierreCajaError('La caja no existe.');
      }
      const actual: any = snap.data();

      if (actual.abierta === false) {
        const quien = actual.cerradaPor?.nombre || actual.cerradaPor?.usuario || 'otro usuario';
        throw new CierreCajaError(`Esta caja ya fue cerrada por ${quien}.`);
      }

      // Si mientras se contaba la plata entró una venta, los totales ya no son correctos
      if (typeof actual.cantidadVentas === 'number' && actual.cantidadVentas !== resumen.documentosVentas) {
        throw new CierreCajaError('Se registró una venta mientras se hacía el cierre. Volvé a calcular el cierre.');
      }
      if (typeof actual.cantidadAnulaciones === 'number' && actual.cantidadAnulaciones !== resumen.cantidadAnuladas) {
        throw new CierreCajaError('Se anuló un ticket mientras se hacía el cierre. Volvé a calcular el cierre.');
      }
      if (typeof actual.cantidadMovimientos === 'number' && actual.cantidadMovimientos !== resumen.operacionesMovimientos) {
        throw new CierreCajaError('Se registró un movimiento de caja mientras se hacía el cierre. Volvé a calcular el cierre.');
      }

      tx.update(cajaRef, {
        abierta: false,
        fechaCierre,
        fechaCierreServidor: serverTimestamp(),
        cerradaPor: usuario,
        cierre: JSON.parse(JSON.stringify(cierre))
      });

      this.auditoria.registrarEnTransaccion(tx, registro);
    });

    // Si era la caja activa de esta PC, la limpiamos
    const local = this.getCajaActiva();
    if (local?.id === caja.id) {
      this.clearCajaActiva();
    }

    return { ...caja, abierta: false, fechaCierre, cerradaPor: usuario, cierre };
  }

  /** Cajas abiertas en un rango de fechas (para la caja del día del admin) */
  async obtenerCajasEntre(inicio: Date, fin: Date): Promise<any[]> {
    const snap = await getDocs(query(
      collection(this.firestore, 'Cajas'),
      where('fechaApertura', '>=', inicio.toISOString()),
      where('fechaApertura', '<=', fin.toISOString())
    ));
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() } as any))
      .sort((a, b) => String(a.fechaApertura).localeCompare(String(b.fechaApertura)));
  }

  private redondear(n: number): number {
    return Math.round((Number(n) || 0) * 100) / 100;
  }

  getCajaActivaLocalValidada(): any | null {
  const raw = localStorage.getItem(this.STORAGE_KEY);
  if (!raw) return null;
  try {
    const caja = JSON.parse(raw);
    if (this.esMismoDiaLocal(caja.fechaApertura)) {
      return caja;
    } else {
      // si la fecha NO es de hoy, limpiamos la cache local
      this.clearCajaActiva();
      return null;
    }
  } catch (err) {
    // si no se puede parsear, limpiamos por seguridad
    this.clearCajaActiva();
    return null;
  }
}

/** Normaliza distintos tipos de fecha y dice si la fecha corresponde a hoy */
private esMismoDiaLocal(fechaAny: any): boolean {
  if (!fechaAny) return false;
  let d: Date;
  // Firestore Timestamp (tiene toDate)
  if (fechaAny && typeof fechaAny.toDate === 'function') {
    d = fechaAny.toDate();
  } else if (fechaAny && typeof fechaAny.seconds === 'number') {
    d = new Date(fechaAny.seconds * 1000);
  } else if (typeof fechaAny === 'string') {
    d = new Date(fechaAny);
  } else if (fechaAny instanceof Date) {
    d = fechaAny;
  } else {
    d = new Date(fechaAny);
  }
  if (isNaN(d.getTime())) return false;
  const now = new Date();
  return d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
}
}
