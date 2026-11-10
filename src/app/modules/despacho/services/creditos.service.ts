import { Injectable } from '@angular/core';
import {
  Firestore,
  Transaction,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  runTransaction,
  serverTimestamp
} from '@angular/fire/firestore';
import { AuditoriaService, UsuarioRegistro } from 'src/app/shared/services/auditoria.service';
import { CajeroVenta, nombreCajero } from 'src/app/modules/admin/services/cajeros.service';
import { PagoVenta, metodoResumen, limpiarDetalle, METODOS_SIN_DINERO } from './pagos';
import { AplicacionCuota, CuotaCredito, imputarCuotas, revertirCuotas, saldoCuotas } from './credito-casa';

/** Crédito de la casa (Creditos/{ventaId}) */
export interface Credito {
  id: string;
  ventaId: string;
  nroTicket: number | null;
  fecha: string;
  sucursalId: string | null;
  cliente: { id: string; nombre: string; dni: any; telefono: string; direccion: string };
  detalle: string;
  equipos: { nombre: string; imei: string }[];
  precioContado: number;
  precioFinanciado: number;
  recargo: number;
  canje: { monto: number; detalle: string } | null;
  entrega: number;
  importe: number;          // lo financiado
  saldo: number;            // lo que falta
  pagado: number;
  cantidadCuotas: number;
  cuotas: CuotaCredito[];
  estado: 'vigente' | 'cancelado' | 'anulado';
  ultimoPago?: string | null;
  anulado?: any;
}

/** Pago de cuotas (Creditos/{id}/Pagos/{ventaId del ticket del cobro}) */
export interface PagoCredito {
  id: string;
  ventaId: string;
  nroTicket: number | null;
  fecha: string;
  importe: number;          // capital que cancela (se aplica a las cuotas)
  recargo: number;          // recargo por mora (no baja la deuda)
  cobrado: number;          // importe + recargo (lo que entró a la caja)
  pagos: PagoVenta[];
  aplicaciones: AplicacionCuota[];
  saldoAnterior: number;
  saldoPosterior: number;
  anulado: boolean;
}

export class CreditoError extends Error {
  constructor(message: string) {
    super(message);
  }
}

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** Lectura para anular el ticket de un cobro de cuotas (fase de lecturas de la transacción) */
export interface LecturaAnulacionCuota {
  creditoRef: any;
  credito: any;
  pagoRef: any;
  pago: any;
}

/**
 * Créditos de la casa: listado, cobro de cuotas en Despacho y su anulación.
 * El cobro es un ticket (Ventas, tipoVenta 'cobrocuota'): entra a la caja y se reimprime desde Tickets.
 */
@Injectable({ providedIn: 'root' })
export class CreditosService {

  constructor(private firestore: Firestore, private auditoria: AuditoriaService) { }

  refCredito(id: string) {
    return doc(this.firestore, 'Creditos', id);
  }

  /** Créditos con saldo (vigentes), el que debe más viejo primero */
  async vigentes(): Promise<Credito[]> {
    const snap = await getDocs(query(collection(this.firestore, 'Creditos'), where('estado', '==', 'vigente')));
    return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as Credito));
  }

  /** Todos los créditos (vigentes, cancelados y anulados) para Gestiones → Créditos */
  async todos(): Promise<Credito[]> {
    const snap = await getDocs(collection(this.firestore, 'Creditos'));
    return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as Credito));
  }

  async obtener(id: string): Promise<Credito | null> {
    const snap = await getDoc(this.refCredito(id));
    return snap.exists() ? ({ id: snap.id, ...(snap.data() as any) } as Credito) : null;
  }

  /** Pagos de un crédito, del más nuevo al más viejo */
  async pagosDe(creditoId: string): Promise<PagoCredito[]> {
    const snap = await getDocs(collection(this.firestore, 'Creditos', creditoId, 'Pagos'));
    return snap.docs
      .map(d => ({ id: d.id, ...(d.data() as any) } as PagoCredito))
      .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  }

  /** Ticket guardado (para reimprimir un comprobante) */
  async ticket(ventaId: string): Promise<any | null> {
    const snap = await getDoc(doc(this.firestore, 'Ventas', ventaId));
    return snap.exists() ? { id: snap.id, ...(snap.data() as any) } : null;
  }

  // =====================================================
  // COBRO DE CUOTAS
  // =====================================================

  /**
   * Cobra cuotas en una sola transacción:
   *  ticket (Ventas 'cobrocuota', entra a la caja) + cuotas y saldo del crédito + pago del crédito
   *  + contador de la caja + auditoría.
   * @param importe lo que se aplica a las cuotas (la más vieja primero)
   * @param recargo recargo por mora (opcional, lo decide el cajero: entra a la caja pero no baja la deuda)
   */
  async cobrar(
    caja: any,
    creditoId: string,
    importe: number,
    recargo: number,
    pagosIngresados: { metodo: string; monto: number; detalle?: string }[],
    cajero: CajeroVenta | null,
    efectivo: { efectivoRecibido: number | null; vuelto: number | null } = { efectivoRecibido: null, vuelto: null }
  ): Promise<{ venta: any; saldoRestante: number; aplicaciones: AplicacionCuota[]; cancelado: boolean }> {

    const usuario = this.auditoria.getUsuarioActual();
    if (!usuario) throw new CreditoError('No se pudo identificar al usuario. Volvé a iniciar sesión.');
    if (!caja?.id) throw new CreditoError('No hay una caja abierta.');
    if (!cajero?.id) throw new CreditoError('Elegí el cajero que cobra.');

    const capital = r2(importe);
    const mora = r2(recargo);
    if (!(capital > 0)) throw new CreditoError('El monto a pagar tiene que ser mayor a 0.');
    if (mora < 0) throw new CreditoError('El recargo no puede ser negativo.');
    const cobrado = r2(capital + mora);

    const pagos: PagoVenta[] = (pagosIngresados || []).map(p => ({
      metodo: p.metodo as any,
      monto: r2(p.monto),
      porcentajeDescuento: 0,
      descuento: 0,
      ...(limpiarDetalle(p.detalle) ? { detalle: limpiarDetalle(p.detalle) } : {})
    }));
    if (!pagos.length || pagos.some(p => !p.metodo)) throw new CreditoError('Elegí el método de pago.');
    if (pagos.some(p => METODOS_SIN_DINERO.includes(p.metodo as any))) {
      throw new CreditoError('Las cuotas se pagan con efectivo, tarjeta o transferencia.');
    }
    if (pagos.some(p => !(p.monto > 0))) throw new CreditoError('Cada medio de pago tiene que tener un monto mayor a 0.');
    if (Math.abs(r2(pagos.reduce((a, p) => a + p.monto, 0)) - cobrado) > 0.009) {
      throw new CreditoError('Los medios de pago no suman lo que hay que cobrar. Volvé a cargar el cobro.');
    }

    const creditoRef = this.refCredito(creditoId);
    const cajaRef = doc(this.firestore, 'Cajas', caja.id);
    const contadorRef = doc(this.firestore, 'Contador Tickets', 'general');
    const ventaRef = doc(collection(this.firestore, 'Ventas'));
    const pagoRef = doc(this.firestore, 'Creditos', creditoId, 'Pagos', ventaRef.id);

    const registro = await this.auditoria.armarRegistro({
      accion: 'venta',
      entidad: 'Ventas',
      entidadId: ventaRef.id,
      descripcion: `Cobro de cuotas del crédito de la casa por $${cobrado.toFixed(2)}` +
        (mora > 0 ? ` (incluye $${mora.toFixed(2)} de recargo por mora)` : '') +
        ` (${pagos.length === 1 ? pagos[0].metodo : pagos.map(p => `${p.metodo} $${p.monto.toFixed(2)}`).join(' + ')})` +
        ` · cobró ${nombreCajero(cajero)}`,
      extra: { creditoId, capital, recargo: mora, cobrado, pagos: pagos.map(p => `${p.metodo}: ${p.monto}${p.detalle ? ` (${p.detalle})` : ''}`) }
    });
    const descripcionBase = registro?.descripcion || '';

    let venta: any = null;
    let saldoRestante = 0;
    let aplicaciones: AplicacionCuota[] = [];

    await runTransaction(this.firestore, async (tx) => {
      // ---------- Lecturas ----------
      const creditoSnap = await tx.get(creditoRef);
      const cajaSnap = await tx.get(cajaRef);
      const contadorSnap = await tx.get(contadorRef);

      const datosCaja: any = cajaSnap.exists() ? cajaSnap.data() : null;
      if (!datosCaja || datosCaja.abierta === false) {
        throw new CreditoError('La caja está cerrada. Abrí una caja para cobrar.');
      }
      const credito: any = creditoSnap.exists() ? creditoSnap.data() : null;
      if (!credito) throw new CreditoError('El crédito ya no existe.');
      if (credito.estado === 'anulado') throw new CreditoError('Este crédito fue anulado.');
      const saldoActual = saldoCuotas(credito.cuotas || []);
      if (credito.estado === 'cancelado' || saldoActual <= 0.004) throw new CreditoError('Este crédito ya está cancelado: no debe nada.');
      if (capital > saldoActual + 0.009) {
        throw new CreditoError(`El monto supera lo que debe el cliente (${this.moneda(saldoActual)}).`);
      }

      // ---------- Imputación (la cuota más vieja primero, con los datos actuales) ----------
      const imp = imputarCuotas(credito.cuotas || [], capital);
      if (imp.sobrante > 0.009) {
        throw new CreditoError('El crédito cambió mientras se cobraba. Volvé a abrirlo e intentá de nuevo.');
      }
      aplicaciones = imp.aplicaciones;
      saldoRestante = saldoCuotas(imp.cuotas);
      const cancelado = saldoRestante <= 0.004;

      // ---------- Escrituras ----------
      const fecha = new Date().toISOString();
      const nroTicket = (contadorSnap.exists() ? (Number((contadorSnap.data() as any).valor) || 0) : 0) + 1;
      const textoCuotas = aplicaciones.map(a => a.numero).join(', ');
      venta = {
        fecha,
        tipoVenta: 'cobrocuota',
        tipoPrecio: 'minorista',
        cliente: { id: credito.cliente.id, dni: credito.cliente.dni ?? null, nombre: credito.cliente.nombre, tipo: 'minorista' },
        items: [
          {
            productoId: null,
            tipo: 'cuota',
            nombre: `Pago crédito de la casa · cuota${aplicaciones.length > 1 ? 's' : ''} ${textoCuotas} de ${credito.cantidadCuotas}`,
            cantidad: 1,
            precioUnitario: capital,
            subtotal: capital
          },
          ...(mora > 0 ? [{ productoId: null, tipo: 'recargo', nombre: 'Recargo por pago fuera de término', cantidad: 1, precioUnitario: mora, subtotal: mora }] : [])
        ],
        subtotal: cobrado,
        total: cobrado,                    // entra a la caja
        metodoPago: metodoResumen(pagos),
        pagos,
        sucursalId: caja.sucursalId,
        cajaId: caja.id,
        usuario,
        cajero,
        efectivoRecibido: efectivo.efectivoRecibido ?? null,
        vuelto: efectivo.vuelto ?? null,
        nroTicket,
        cuotaCredito: {
          creditoId,
          ventaCredito: credito.ventaId,
          nroTicketCredito: credito.nroTicket ?? null,
          capital,
          recargo: mora,
          aplicaciones,
          cuotas: imp.cuotas.map(c => ({ numero: c.numero, importe: c.importe, pagado: c.pagado, hasta: c.hasta })),
          saldoAnterior: saldoActual,
          saldoPosterior: saldoRestante,
          cantidadCuotas: credito.cantidadCuotas
        }
      };
      tx.set(contadorRef, { valor: nroTicket }, { merge: true });
      tx.set(ventaRef, venta);

      const pago: Omit<PagoCredito, 'id'> & any = {
        ventaId: ventaRef.id,
        nroTicket,
        fecha,
        importe: capital,
        recargo: mora,
        cobrado,
        pagos,
        aplicaciones,
        saldoAnterior: saldoActual,
        saldoPosterior: saldoRestante,
        sucursalId: caja.sucursalId || null,
        cajaId: caja.id,
        usuario,
        cajero,
        anulado: false
      };
      tx.set(pagoRef, pago);

      tx.update(creditoRef, {
        cuotas: imp.cuotas,
        saldo: saldoRestante,
        pagado: r2((Number(credito.importe) || 0) - saldoRestante),
        estado: cancelado ? 'cancelado' : 'vigente',
        ultimoPago: fecha,
        ...(cancelado ? { canceladoEn: fecha } : {})
      });

      tx.update(cajaRef, { cantidadVentas: (Number(datosCaja.cantidadVentas) || 0) + 1 });

      if (registro) {
        registro.descripcion = `Ticket #${String(nroTicket).padStart(8, '0')} - ${descripcionBase} · ${credito.cliente.nombre}, ` +
          `cuota(s) ${textoCuotas}` + (cancelado ? ' · CRÉDITO CANCELADO' : ` · saldo ${this.moneda(saldoRestante)}`);
      }
      this.auditoria.registrarEnTransaccion(tx, registro);
    });

    return { venta: { ...venta, id: ventaRef.id }, saldoRestante, aplicaciones, cancelado: saldoRestante <= 0.004 };
  }

  // =====================================================
  // ANULACIÓN DEL TICKET DE UN COBRO (la llama TicketsService.anular dentro de su transacción)
  // =====================================================

  /** Fase de LECTURAS. null si el ticket no es un cobro de cuotas o ya no hay nada que revertir. */
  async leerAnulacion(tx: Transaction, venta: any): Promise<LecturaAnulacionCuota | null> {
    if (venta?.tipoVenta !== 'cobrocuota' || !venta.cuotaCredito?.creditoId) return null;
    const creditoRef = this.refCredito(venta.cuotaCredito.creditoId);
    const pagoRef = doc(this.firestore, 'Creditos', venta.cuotaCredito.creditoId, 'Pagos', venta.id);
    const creditoSnap = await tx.get(creditoRef);
    const pagoSnap = await tx.get(pagoRef);
    const credito: any = creditoSnap.exists() ? creditoSnap.data() : null;
    const pago: any = pagoSnap.exists() ? pagoSnap.data() : null;
    if (!credito || !pago || pago.anulado) return null;
    if (credito.estado === 'anulado') throw new CreditoError('El crédito de este cobro está anulado.');
    return { creditoRef, credito, pagoRef, pago };
  }

  /** Fase de ESCRITURAS: las cuotas vuelven a quedar pendientes */
  escribirAnulacion(tx: Transaction, l: LecturaAnulacionCuota, motivo: string, usuario: UsuarioRegistro): void {
    const cuotas = revertirCuotas(l.credito.cuotas || [], l.pago.aplicaciones || []);
    const saldo = saldoCuotas(cuotas);
    tx.update(l.pagoRef, { anulado: true, motivoAnulacion: motivo, anuladoPor: usuario, anuladoEn: serverTimestamp() });
    tx.update(l.creditoRef, {
      cuotas,
      saldo,
      pagado: r2((Number(l.credito.importe) || 0) - saldo),
      estado: saldo > 0.004 ? 'vigente' : 'cancelado'
    });
  }

  private moneda(n: number): string {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(Number(n) || 0);
  }
}
