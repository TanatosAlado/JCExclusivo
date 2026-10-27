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
import { PagoVenta, metodoResumen } from './pagos';

/** Colecciones donde puede estar una orden de taller */
export const COLECCIONES_ORDENES = ['Ordenes Pendientes', 'Ordenes Finalizadas'];

/** Un cobro registrado en la orden */
export interface CobroOrden {
  ventaId: string;
  nroTicket: number;
  monto: number;
  metodoPago: string;            // el medio, o 'mixto'
  pagos?: PagoVenta[];           // detalle si pagó con varios medios
  fecha: string;
  usuario: { uid: string; usuario: string; nombre: string };
  anulado?: boolean;
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
  async cobrar(
    caja: any,
    orden: any,
    pagosIngresados: { metodo: string; monto: number }[],
    entregar: boolean
  ): Promise<{ venta: any; saldoRestante: number; entregada: boolean }> {

    const usuario = this.auditoria.getUsuarioActual();
    if (!usuario) throw new CobroReparacionError('No se pudo identificar al usuario. Volvé a iniciar sesión.');
    if (!caja?.id) throw new CobroReparacionError('No hay una caja abierta.');

    const pagos: PagoVenta[] = (pagosIngresados || []).map(p => ({
      metodo: p.metodo as any,
      monto: this.redondear(Number(p.monto) || 0),
      porcentajeDescuento: 0,
      descuento: 0
    }));
    if (!pagos.length || pagos.some(p => !p.metodo)) throw new CobroReparacionError('Elegí el método de pago.');
    if (pagos.some(p => !(p.monto > 0))) throw new CobroReparacionError('Cada medio de pago tiene que tener un monto mayor a 0.');
    const importe = this.redondear(pagos.reduce((a, p) => a + p.monto, 0));
    if (!(importe > 0)) throw new CobroReparacionError('El monto tiene que ser mayor a 0.');
    const metodoPago = metodoResumen(pagos);
    const textoPagos = pagos.length === 1
      ? metodoPago
      : pagos.map(p => `${p.metodo} $${p.monto.toFixed(2)}`).join(' + ');

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
      subtotal: importe,
      total: importe,
      metodoPago,
      pagos,
      sucursalId: caja.sucursalId,
      cajaId: caja.id,
      usuario,
      nroTicket: null
    };

    const registro = await this.auditoria.armarRegistro({
      accion: 'venta',
      entidad: 'Ventas',
      entidadId: ventaRef.id,
      descripcion: `Cobro de reparación orden #${orden.numeroOrden} por $${importe.toFixed(2)} (${textoPagos})` +
        (entregar ? ' y entrega del equipo' : ''),
      extra: { ordenId: orden.id, numeroOrden: orden.numeroOrden, monto: importe, metodoPago, pagos: pagos.map(p => `${p.metodo}: ${p.monto}`), entregar }
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
        metodoPago,
        pagos,
        fecha: venta.fecha,
        usuario,
        anulado: false
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
