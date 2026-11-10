import { Injectable } from '@angular/core';
import {
  Firestore,
  collection,
  doc,
  query,
  where,
  getDocs,
  runTransaction,
  serverTimestamp
} from '@angular/fire/firestore';
import { AuditoriaService } from 'src/app/shared/services/auditoria.service';
import { TicketsService } from './tickets.service';
import { PagoVenta, metodoResumen, limpiarDetalle } from './pagos';
import { CajeroVenta, nombreCajero } from 'src/app/modules/admin/services/cajeros.service';
import { DesgloseCobro, imputarCobroReparacion } from './desglose-reparacion';

/** Medios a los que se les puede hacer descuento al cobrar una reparación */
export const METODOS_CON_DESCUENTO_REPARACION = ['efectivo', 'transferencia'];

/** Colecciones donde puede estar una orden de taller */
export const COLECCIONES_ORDENES = ['Ordenes Pendientes', 'Ordenes Finalizadas'];

/** Un cobro registrado en la orden */
export interface CobroOrden {
  ventaId: string;
  nroTicket: number;
  monto: number;                 // lo que se descuenta del saldo de la orden (incluye el descuento)
  cobrado?: number;              // lo que efectivamente pagó (si hubo descuento)
  descuento?: number;            // descuento por efectivo / transferencia
  metodoPago: string;            // el medio, o 'mixto'
  pagos?: PagoVenta[];           // detalle si pagó con varios medios
  fecha: string;
  usuario: { uid: string; usuario: string; nombre: string };
  cajero?: CajeroVenta | null;   // quién cobró
  anulado?: boolean;
  desglose?: DesgloseCobro | null; // mano de obra / repuestos (null: orden sin discriminar)
}

export class CobroReparacionError extends Error {
  constructor(message: string) {
    super(message);
  }
}

/**
 * Cobro de reparaciones del taller desde despacho.
 *  - Permite cobros parciales (seña + saldo).
 *  - Cada cobro genera una venta/ticket del tipo 'reparacion' (entra en la caja y en el cierre).
 *  - Opcionalmente entrega el equipo (pasa la orden a 'Ordenes Finalizadas').
 */
@Injectable({ providedIn: 'root' })
export class CobroReparacionesService {

  constructor(
    private firestore: Firestore,
    private auditoria: AuditoriaService,
    private tickets: TicketsService
  ) { }

  // =====================================================
  // BÚSQUEDA
  // =====================================================

  async buscarPorNumero(numeroOrden: number): Promise<any[]> {
    return this.buscar('numeroOrden', numeroOrden);
  }

  async buscarPorDni(dni: number): Promise<any[]> {
    // El DNI puede estar guardado como número o como texto
    const [comoNumero, comoTexto] = await Promise.all([
      this.buscar('dniCliente', dni),
      this.buscar('dniCliente', String(dni))
    ]);
    const vistos = new Set<string>();
    return [...comoNumero, ...comoTexto].filter(o => {
      const clave = `${o.coleccion}/${o.id}`;
      if (vistos.has(clave)) return false;
      vistos.add(clave);
      return true;
    });
  }

  private async buscar(campo: string, valor: any): Promise<any[]> {
    const resultados = await Promise.all(COLECCIONES_ORDENES.map(async col => {
      const snap = await getDocs(query(collection(this.firestore, col), where(campo, '==', valor)));
      return snap.docs.map(d => ({ id: d.id, coleccion: col, ...d.data() }));
    }));
    return resultados.flat().sort((a: any, b: any) => (b.numeroOrden || 0) - (a.numeroOrden || 0));
  }

  // =====================================================
  // SALDOS
  // =====================================================

  totalPagado(orden: any): number {
    return this.redondear((orden?.cobros || [])
      .filter((c: CobroOrden) => !c.anulado)
      .reduce((acc: number, c: CobroOrden) => acc + (Number(c.monto) || 0), 0));
  }

  saldo(orden: any): number {
    return this.redondear(Math.max(0, (Number(orden?.presupuesto) || 0) - this.totalPagado(orden)));
  }

  // =====================================================
  // COBRO
  // =====================================================

  /**
   * Registra el cobro en una sola transacción:
   *  venta/ticket (numerado) + cobro en la orden + contador de la caja + auditoría
   *  (+ pasa la orden a Finalizadas si se entrega el equipo).
   *  Puede pagarse con uno o varios medios (pagos); las reparaciones no tienen descuento por medio de pago.
   */
  /**
   * Descuento manual (efectivo / transferencia): el cliente paga menos y se cancela el saldo igual.
   * Ej: saldo $100.000, 10% en efectivo → paga $90.000 y la orden queda cancelada.
   * pagosIngresados.monto = lo que paga con ese medio; descuento = lo que cancela de más.
   */
  async cobrar(
    caja: any,
    orden: any,
    pagosIngresados: { metodo: string; monto: number; porcentajeDescuento?: number; descuento?: number; detalle?: string }[],
    entregar: boolean,
    cajero: CajeroVenta | null,
    efectivo: { efectivoRecibido: number | null; vuelto: number | null } = { efectivoRecibido: null, vuelto: null }
  ): Promise<{ venta: any; saldoRestante: number; entregada: boolean }> {

    const usuario = this.auditoria.getUsuarioActual();
    if (!usuario) throw new CobroReparacionError('No se pudo identificar al usuario. Volvé a iniciar sesión.');
    if (!caja?.id) throw new CobroReparacionError('No hay una caja abierta.');
    if (!cajero?.id) throw new CobroReparacionError('Elegí el cajero que cobra.');

    const pagos: PagoVenta[] = (pagosIngresados || []).map(p => {
      const pct = METODOS_CON_DESCUENTO_REPARACION.includes(p.metodo) ? Math.max(0, Number(p.porcentajeDescuento) || 0) : 0;
      return {
        metodo: p.metodo as any,
        monto: this.redondear(Number(p.monto) || 0),
        porcentajeDescuento: pct,
        descuento: pct > 0 ? this.redondear(Number(p.descuento) || 0) : 0,
        ...(limpiarDetalle(p.detalle) ? { detalle: limpiarDetalle(p.detalle) } : {})   // nº de operación (tarjeta)
      };
    });
    if (!pagos.length || pagos.some(p => !p.metodo)) throw new CobroReparacionError('Elegí el método de pago.');
    if (pagos.some(p => !(p.monto > 0))) throw new CobroReparacionError('Cada medio de pago tiene que tener un monto mayor a 0.');
    for (const p of pagos.filter(x => x.porcentajeDescuento > 0)) {
      if (p.porcentajeDescuento >= 100) throw new CobroReparacionError('El descuento tiene que ser menor al 100%.');
      // El descuento tiene que corresponder al % (con margen de redondeo a centavos)
      const esperado = p.monto / (1 - p.porcentajeDescuento / 100) - p.monto;
      const margen = 0.02 + 0.01 / (1 - p.porcentajeDescuento / 100);
      if (p.descuento < 0 || Math.abs(p.descuento - esperado) > margen) {
        throw new CobroReparacionError('El descuento no coincide con el porcentaje. Volvé a cargar el cobro.');
      }
    }
    const cobrado = this.redondear(pagos.reduce((a, p) => a + p.monto, 0));     // lo que entra a la caja
    const descuento = this.redondear(pagos.reduce((a, p) => a + p.descuento, 0));
    const importe = this.redondear(cobrado + descuento);                         // lo que se descuenta del saldo
    if (!(importe > 0)) throw new CobroReparacionError('El monto tiene que ser mayor a 0.');
    const metodoPago = metodoResumen(pagos);
    const pctTexto = pagos.find(p => p.descuento > 0)?.porcentajeDescuento;
    const textoPagos = (pagos.length === 1
      ? metodoPago
      : pagos.map(p => `${p.metodo} $${p.monto.toFixed(2)}`).join(' + ')) +
      (descuento > 0 ? `, descuento ${pctTexto}%: $${descuento.toFixed(2)}` : '');

    const ordenRef = doc(this.firestore, orden.coleccion, orden.id);
    const cajaRef = doc(this.firestore, 'Cajas', caja.id);
    const contadorRef = this.tickets.refContador();
    const ventaRef = doc(collection(this.firestore, 'Ventas'));

    const nombreCliente = [orden.nombreCliente, orden.apellidoCliente].filter(Boolean).join(' ') || 'Cliente';

    const venta: any = {
      fecha: new Date().toISOString(),
      tipoVenta: 'reparacion',
      tipoPrecio: 'minorista',
      cliente: {
        id: orden.idCliente || null,
        dni: orden.dniCliente ?? null,
        nombre: nombreCliente,
        tipo: 'minorista'
      },
      orden: {
        id: orden.id,
        numeroOrden: orden.numeroOrden ?? null,
        equipo: orden.equipo || '',
        imei: orden.imei || ''
      },
      items: [{
        productoId: null,
        tipo: 'reparacion',
        nombre: `Reparación orden #${orden.numeroOrden} - ${orden.equipo || 'equipo'}`,
        cantidad: 1,
        precioUnitario: importe,
        subtotal: importe
      }],
      subtotal: importe,                 // saldo de la orden que se cancela
      descuentoPago: descuento,          // descuento por efectivo / transferencia
      porcentajeDescuentoPago: pagos.length === 1 && descuento > 0 ? pagos[0].porcentajeDescuento : null,
      total: cobrado,                    // lo que efectivamente pagó (entra a la caja)
      metodoPago,
      pagos,
      sucursalId: caja.sucursalId,
      cajaId: caja.id,
      usuario,
      cajero,
      efectivoRecibido: efectivo.efectivoRecibido ?? null, // con cuánto pagó la parte en efectivo
      vuelto: efectivo.vuelto ?? null,                     // solo informativo
      nroTicket: null
    };

    const registro = await this.auditoria.armarRegistro({
      accion: 'venta',
      entidad: 'Ventas',
      entidadId: ventaRef.id,
      descripcion: `Cobro de reparación orden #${orden.numeroOrden} por $${cobrado.toFixed(2)}` +
        (descuento > 0 ? ` (cancela $${importe.toFixed(2)} del saldo)` : '') + ` (${textoPagos})` +
        (entregar ? ' y entrega del equipo' : '') + ` · cobró ${nombreCajero(cajero)}`,
      extra: { ordenId: orden.id, numeroOrden: orden.numeroOrden, monto: importe, cobrado, descuento, metodoPago, pagos: pagos.map(p => `${p.metodo}: ${p.monto}${p.detalle ? ` (${p.detalle})` : ""}`), entregar }
    });
    const descripcionBase = registro?.descripcion || '';

    let saldoRestante = 0;
    let entregada = false;

    await runTransaction(this.firestore, async (tx) => {
      // ---------- Lecturas ----------
      const ordenSnap = await tx.get(ordenRef);
      const cajaSnap = await tx.get(cajaRef);
      const contadorSnap = await tx.get(contadorRef);

      if (!ordenSnap.exists()) {
        throw new CobroReparacionError('La orden ya no está en ' + orden.coleccion + '. Volvé a buscarla.');
      }
      const datosOrden: any = ordenSnap.data();

      const datosCaja: any = cajaSnap.exists() ? cajaSnap.data() : null;
      if (!datosCaja || datosCaja.abierta === false) {
        throw new CobroReparacionError('La caja está cerrada. Abrí una caja para cobrar.');
      }

      // ---------- Validación del saldo (con los datos actuales de la orden) ----------
      const saldoActual = this.saldo(datosOrden);
      if (saldoActual <= 0) {
        throw new CobroReparacionError('Esta orden ya está totalmente pagada.');
      }
      if (importe > saldoActual + 0.009) {
        throw new CobroReparacionError(`El monto supera el saldo pendiente (${this.moneda(saldoActual)}).`);
      }
      saldoRestante = this.redondear(saldoActual - importe);

      // ---------- Mano de obra / repuestos (con los datos actuales de la orden) ----------
      const desglose = imputarCobroReparacion(datosOrden, importe, descuento);
      venta.desglose = desglose;

      // ---------- Escrituras ----------
      const ultimo = contadorSnap.exists() ? (Number((contadorSnap.data() as any).valor) || 0) : 0;
      venta.nroTicket = ultimo + 1;
      venta.saldoRestante = saldoRestante;
      tx.set(contadorRef, { valor: venta.nroTicket }, { merge: true });
      tx.set(ventaRef, venta);

      const cobro: CobroOrden = {
        ventaId: ventaRef.id,
        nroTicket: venta.nroTicket,
        monto: importe,
        cobrado,
        descuento,
        metodoPago,
        pagos,
        fecha: venta.fecha,
        usuario,
        cajero,
        anulado: false,
        desglose
      };
      const cobros = [...(datosOrden.cobros || []), cobro];
      const datosPago = {
        cobros,
        totalPagado: this.redondear(this.totalPagado({ cobros })),
        pagada: saldoRestante <= 0
      };

      if (entregar && orden.coleccion === 'Ordenes Pendientes') {
        // Misma lógica que "Finalizar" en el taller: se mueve a Finalizadas
        tx.set(doc(this.firestore, 'Ordenes Finalizadas', orden.id), {
          ...datosOrden,
          ...datosPago,
          estado: 'Finalizado',
          fechaEntrega: new Date()
        });
        tx.delete(ordenRef);
        entregada = true;
      } else {
        tx.update(ordenRef, datosPago);
      }

      tx.update(cajaRef, { cantidadVentas: (Number(datosCaja.cantidadVentas) || 0) + 1 });

      if (registro) {
        registro.descripcion = `Ticket #${this.tickets.numeroFormateado(venta)} - ${descripcionBase}`;
      }
      this.auditoria.registrarEnTransaccion(tx, registro);
    });

    return { venta: { ...venta, id: ventaRef.id }, saldoRestante, entregada };
  }

  private moneda(n: number): string {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(Number(n) || 0);
  }

  private redondear(n: number): number {
    return Math.round((Number(n) || 0) * 100) / 100;
  }
}
