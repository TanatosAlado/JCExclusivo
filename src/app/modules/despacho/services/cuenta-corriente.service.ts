import { Injectable } from '@angular/core';
import {
  Firestore,
  Transaction,
  DocumentSnapshot,
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
import { PagoVenta, metodoResumen, aCuentaDeVenta, esCobroCuenta, limpiarDetalle } from './pagos';
import { Aplicacion, CargoPendiente, imputarFIFO, redondear } from './cuenta-corriente';

/** Cuenta corriente de un cliente (CuentasCorrientes/{clienteId}) */
export interface CuentaCorriente {
  id: string;              // = id del cliente
  clienteId: string;
  nombre: string;
  dni: any;
  saldo: number;           // lo que debe hoy
  totalCompras: number;    // histórico de compras a cuenta (sin anuladas)
  totalPagos: number;      // histórico de pagos (sin anulados)
  ultimaCompra?: string | null;
  ultimoPago?: string | null;
}

/** Cobro aplicado a una compra (queda guardado en la compra, para saber quién la pagó) */
export interface CobroDeCargo {
  ventaId: string;
  nroTicket: number | null;
  fecha: string;
  importe: number;
  anulado?: boolean;
}

/** Movimiento de la cuenta (CuentasCorrientes/{clienteId}/Movimientos/{id = id de la venta}) */
export interface MovimientoCuenta {
  id: string;
  tipo: 'cargo' | 'pago';
  fecha: string;
  importe: number;
  ventaId: string;
  nroTicket: number | null;
  sucursalId?: string | null;
  cajaId?: string | null;
  usuario?: UsuarioRegistro | null;
  cajero?: CajeroVenta | null;
  saldoAnterior?: number;
  saldoPosterior?: number;
  anulado?: boolean;
  motivoAnulacion?: string;
  // Cargo (compra a cuenta)
  pendiente?: number;
  saldada?: boolean;
  detalle?: string;
  cobros?: CobroDeCargo[];
  // Pago (importe = deuda que canceló; cobrado = lo que pagó; descuento = importe - cobrado)
  pagos?: PagoVenta[];
  aplicaciones?: Aplicacion[];
  cobrado?: number;
  descuento?: number;
}

export class CuentaCorrienteError extends Error {
  constructor(message: string) {
    super(message);
  }
}

/** Datos leídos dentro de la transacción de anulación de un ticket */
export interface LecturaAnulacionCuenta {
  tipo: 'cargo' | 'pago';
  clienteId: string;
  nombreCliente: string;
  importe: number;
  cuentaRef: any;
  cuenta: any;
  movRef: any;
  mov: any;
  cargos: { ref: any; data: any; aplicado: number }[];   // solo al anular un pago
}

/**
 * Cuenta corriente de clientes mayoristas.
 *  - Compra a cuenta: desde Despacho, como un medio de pago más ("Cuenta corriente").
 *    Se registra en la MISMA transacción que la venta (ver escribirCargo).
 *  - Cobro total o parcial: desde Despacho con la caja abierta. Genera un ticket
 *    (tipoVenta 'cobrocuenta') que entra en la caja con el medio con que pagó.
 *    El pago se imputa a las compras más viejas primero.
 *  - Anulación de tickets: una compra a cuenta solo se anula si no tiene pagos imputados;
 *    anular un cobro vuelve a dejar pendientes las compras que había pagado.
 */
@Injectable({ providedIn: 'root' })
export class CuentaCorrienteService {

  static readonly COLECCION = 'CuentasCorrientes';
  static readonly MOVIMIENTOS = 'Movimientos';

  constructor(private firestore: Firestore, private auditoria: AuditoriaService) { }

  refCuenta(clienteId: string) {
    return doc(this.firestore, CuentaCorrienteService.COLECCION, clienteId);
  }

  refMovimiento(clienteId: string, id: string) {
    return doc(this.firestore, CuentaCorrienteService.COLECCION, clienteId, CuentaCorrienteService.MOVIMIENTOS, id);
  }

  // =====================================================
  // CONSULTAS
  // =====================================================

  async obtenerCuenta(clienteId: string): Promise<CuentaCorriente | null> {
    if (!clienteId) return null;
    const snap = await getDoc(this.refCuenta(clienteId));
    return snap.exists() ? CuentaCorrienteService.armarCuenta(snap.id, snap.data()) : null;
  }

  async listarCuentas(): Promise<CuentaCorriente[]> {
    const snap = await getDocs(collection(this.firestore, CuentaCorrienteService.COLECCION));
    return snap.docs.map(d => CuentaCorrienteService.armarCuenta(d.id, d.data()));
  }

  /** Movimientos de la cuenta, del más nuevo al más viejo */
  async movimientos(clienteId: string): Promise<MovimientoCuenta[]> {
    const snap = await getDocs(collection(this.firestore, CuentaCorrienteService.COLECCION, clienteId, CuentaCorrienteService.MOVIMIENTOS));
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() } as MovimientoCuenta))
      .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  }

  /** Compras con saldo pendiente, de la más vieja a la más nueva */
  async comprasPendientes(clienteId: string): Promise<MovimientoCuenta[]> {
    const snap = await getDocs(query(
      collection(this.firestore, CuentaCorrienteService.COLECCION, clienteId, CuentaCorrienteService.MOVIMIENTOS),
      where('saldada', '==', false)
    ));
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() } as MovimientoCuenta))
      .filter(m => m.tipo === 'cargo' && !m.anulado && redondear(Number(m.pendiente)) > 0)
      .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
  }

  static armarCuenta(id: string, d: any): CuentaCorriente {
    return {
      id,
      clienteId: d?.clienteId || id,
      nombre: d?.nombre || 'Cliente',
      dni: d?.dni ?? null,
      saldo: redondear(Number(d?.saldo)),
      totalCompras: redondear(Number(d?.totalCompras)),
      totalPagos: redondear(Number(d?.totalPagos)),
      ultimaCompra: d?.ultimaCompra || null,
      ultimoPago: d?.ultimoPago || null
    };
  }

  // =====================================================
  // COMPRA A CUENTA (dentro de la transacción de la venta)
  // =====================================================

  /**
   * Escribe la compra a cuenta. Llamar en la fase de ESCRITURAS de la transacción de la venta,
   * con la cuenta ya leída (tx.get(refCuenta(clienteId))) en la fase de lecturas.
   */
  escribirCargo(
    tx: Transaction,
    cuentaSnap: DocumentSnapshot<any>,
    datos: {
      cliente: { id: string; nombre: string; dni: any };
      ventaId: string;
      nroTicket: number | null;
      fecha: string;
      importe: number;
      detalle: string;
      sucursalId: string | null;
      cajaId: string | null;
      usuario: UsuarioRegistro | null;
      cajero: CajeroVenta | null;
    }
  ): { saldoAnterior: number; saldoPosterior: number } {
    const importe = redondear(datos.importe);
    if (!(importe > 0)) throw new CuentaCorrienteError('El importe a cuenta corriente tiene que ser mayor a 0.');

    const actual: any = cuentaSnap.exists() ? cuentaSnap.data() : null;
    const saldoAnterior = redondear(Number(actual?.saldo));
    const saldoPosterior = redondear(saldoAnterior + importe);

    tx.set(this.refCuenta(datos.cliente.id), {
      clienteId: datos.cliente.id,
      nombre: datos.cliente.nombre || 'Cliente',
      dni: datos.cliente.dni ?? null,
      saldo: saldoPosterior,
      totalCompras: redondear(Number(actual?.totalCompras) + importe),
      totalPagos: redondear(Number(actual?.totalPagos)),
      ultimaCompra: datos.fecha,
      ultimoPago: actual?.ultimoPago || null,
      actualizada: serverTimestamp(),
      ...(actual ? {} : { creada: serverTimestamp() })
    }, { merge: true });

    const cargo: Omit<MovimientoCuenta, 'id'> = {
      tipo: 'cargo',
      fecha: datos.fecha,
      importe,
      pendiente: importe,
      saldada: false,
      ventaId: datos.ventaId,
      nroTicket: datos.nroTicket,
      detalle: datos.detalle,
      sucursalId: datos.sucursalId,
      cajaId: datos.cajaId,
      usuario: datos.usuario,
      cajero: datos.cajero,
      saldoAnterior,
      saldoPosterior,
      cobros: [],
      anulado: false
    };
    tx.set(this.refMovimiento(datos.cliente.id, datos.ventaId), cargo);

    return { saldoAnterior, saldoPosterior };
  }

  // =====================================================
  // COBRO (total o parcial) desde Despacho
  // =====================================================

  /**
   * Descuento manual por pagar en efectivo: el cliente paga menos y se le cancela la deuda completa.
   * Ej: deuda $100.000, 10% en efectivo → paga $90.000 y cancela $100.000.
   * pagosIngresados.monto = lo que paga con ese medio; descuento = lo que cancela de más.
   *
   * Registra el pago en una sola transacción:
   *  ticket (venta 'cobrocuenta', entra en la caja) + imputación a las compras más viejas
   *  + saldo de la cuenta + movimiento de pago + contador de la caja + auditoría.
   */
  async cobrar(
    caja: any,
    cliente: { id: string; nombre: string; dni: any },
    pagosIngresados: { metodo: string; monto: number; porcentajeDescuento?: number; descuento?: number; detalle?: string }[],
    cajero: CajeroVenta | null,
    efectivo: { efectivoRecibido: number | null; vuelto: number | null } = { efectivoRecibido: null, vuelto: null }
  ): Promise<{ venta: any; saldoRestante: number; aplicaciones: Aplicacion[] }> {

    const usuario = this.auditoria.getUsuarioActual();
    if (!usuario) throw new CuentaCorrienteError('No se pudo identificar al usuario. Volvé a iniciar sesión.');
    if (!caja?.id) throw new CuentaCorrienteError('No hay una caja abierta.');
    if (!cliente?.id) throw new CuentaCorrienteError('Elegí el cliente.');
    if (!cajero?.id) throw new CuentaCorrienteError('Elegí el cajero que cobra.');

    const pagos: PagoVenta[] = (pagosIngresados || []).map(p => {
      const monto = redondear(Number(p.monto) || 0);
      const pct = p.metodo === 'efectivo' ? Math.max(0, Number(p.porcentajeDescuento) || 0) : 0;
      return {
        metodo: p.metodo as any,
        monto,
        porcentajeDescuento: pct,
        descuento: pct > 0 ? redondear(Number(p.descuento) || 0) : 0,
        ...(limpiarDetalle(p.detalle) ? { detalle: limpiarDetalle(p.detalle) } : {})   // nº de operación (tarjeta)
      };
    });
    if (!pagos.length || pagos.some(p => !p.metodo)) throw new CuentaCorrienteError('Elegí el método de pago.');
    if (pagos.some(p => p.metodo === 'cuentacorriente')) throw new CuentaCorrienteError('Una deuda no se puede pagar con cuenta corriente.');
    if (pagos.some(p => !(p.monto > 0))) throw new CuentaCorrienteError('Cada medio de pago tiene que tener un monto mayor a 0.');
    for (const p of pagos.filter(x => x.porcentajeDescuento > 0)) {
      if (p.porcentajeDescuento >= 100) throw new CuentaCorrienteError('El descuento tiene que ser menor al 100%.');
      // El descuento tiene que corresponder al % (con margen de redondeo)
      const esperado = p.monto / (1 - p.porcentajeDescuento / 100) - p.monto;
      const margen = 0.02 + 0.01 / (1 - p.porcentajeDescuento / 100);   // redondeo a centavos
      if (p.descuento < 0 || Math.abs(p.descuento - esperado) > margen) {
        throw new CuentaCorrienteError('El descuento no coincide con el porcentaje. Volvé a cargar el cobro.');
      }
    }
    const cobrado = redondear(pagos.reduce((a, p) => a + p.monto, 0));        // lo que entra a la caja
    const descuento = redondear(pagos.reduce((a, p) => a + p.descuento, 0));
    const importe = redondear(cobrado + descuento);                            // deuda que se cancela
    if (!(importe > 0)) throw new CuentaCorrienteError('El monto tiene que ser mayor a 0.');
    const metodoPago = metodoResumen(pagos);
    const textoPagos = (pagos.length === 1 ? metodoPago : pagos.map(p => `${p.metodo} $${p.monto.toFixed(2)}`).join(' + ')) +
      (descuento > 0 ? `, descuento ${pagos.find(p => p.descuento > 0)?.porcentajeDescuento}% en efectivo: $${descuento.toFixed(2)}` : '');

    // Compras pendientes (la consulta va afuera: dentro de la transacción se vuelve a leer cada una)
    const pendientes = await this.comprasPendientes(cliente.id);

    const cuentaRef = this.refCuenta(cliente.id);
    const cajaRef = doc(this.firestore, 'Cajas', caja.id);
    const contadorRef = doc(this.firestore, 'Contador Tickets', 'general');
    const ventaRef = doc(collection(this.firestore, 'Ventas'));
    const pagoRef = this.refMovimiento(cliente.id, ventaRef.id);

    const venta: any = {
      fecha: new Date().toISOString(),
      tipoVenta: 'cobrocuenta',
      tipoPrecio: 'mayorista',
      cliente: { id: cliente.id, dni: cliente.dni ?? null, nombre: cliente.nombre, tipo: 'mayorista' },
      items: [{
        productoId: null,
        tipo: 'cobrocuenta',
        nombre: 'Pago a cuenta corriente',
        cantidad: 1,
        precioUnitario: importe,
        subtotal: importe
      }],
      subtotal: importe,                 // deuda que cancela
      descuentoPago: descuento,          // descuento por pagar en efectivo
      porcentajeDescuentoPago: pagos.length === 1 && descuento > 0 ? pagos[0].porcentajeDescuento : null,
      total: cobrado,                    // lo que efectivamente pagó (entra a la caja)
      metodoPago,
      pagos,
      sucursalId: caja.sucursalId,
      cajaId: caja.id,
      usuario,
      cajero,
      efectivoRecibido: efectivo.efectivoRecibido ?? null,
      vuelto: efectivo.vuelto ?? null,
      nroTicket: null,
      cuentaCorriente: null
    };

    const registro = await this.auditoria.armarRegistro({
      accion: 'venta',
      entidad: 'Ventas',
      entidadId: ventaRef.id,
      descripcion: `Cobro de cuenta corriente de ${cliente.nombre} por $${cobrado.toFixed(2)}` +
        (descuento > 0 ? ` (cancela $${importe.toFixed(2)} de deuda)` : '') + ` (${textoPagos}) · cobró ${nombreCajero(cajero)}`,
      extra: { clienteId: cliente.id, cobrado, descuento, deudaCancelada: importe, metodoPago, pagos: pagos.map(p => `${p.metodo}: ${p.monto}${p.detalle ? ` (${p.detalle})` : ""}`) }
    });
    const descripcionBase = registro?.descripcion || '';

    let saldoRestante = 0;
    let aplicaciones: Aplicacion[] = [];

    await runTransaction(this.firestore, async (tx) => {
      // ---------- Lecturas ----------
      const cuentaSnap = await tx.get(cuentaRef);
      const cajaSnap = await tx.get(cajaRef);
      const contadorSnap = await tx.get(contadorRef);
      const cargos: { ref: any; data: any }[] = [];
      for (const p of pendientes) {
        const ref = this.refMovimiento(cliente.id, p.id);
        const snap = await tx.get(ref);
        if (snap.exists()) cargos.push({ ref, data: { id: snap.id, ...snap.data() } });
      }

      const datosCaja: any = cajaSnap.exists() ? cajaSnap.data() : null;
      if (!datosCaja || datosCaja.abierta === false) {
        throw new CuentaCorrienteError('La caja está cerrada. Abrí una caja para cobrar.');
      }
      const cuenta: any = cuentaSnap.exists() ? cuentaSnap.data() : null;
      const saldoActual = redondear(Number(cuenta?.saldo));
      if (!cuenta || saldoActual <= 0) {
        throw new CuentaCorrienteError(`${cliente.nombre} no tiene deuda en su cuenta corriente.`);
      }
      if (importe > saldoActual + 0.009) {
        throw new CuentaCorrienteError(`El monto supera la deuda del cliente (${this.moneda(saldoActual)}).`);
      }

      // ---------- Imputación (compras más viejas primero, con los datos actuales) ----------
      const vigentes: CargoPendiente[] = cargos
        .filter(c => c.data.tipo === 'cargo' && !c.data.anulado)
        .map(c => ({ id: c.data.id, fecha: c.data.fecha, pendiente: Number(c.data.pendiente) || 0, nroTicket: c.data.nroTicket ?? null }));
      const imputacion = imputarFIFO(vigentes, importe);
      if (imputacion.sobrante > 0.009) {
        // Cambió algo mientras tanto (otra compra u otro cobro): que vuelva a intentar
        throw new CuentaCorrienteError('La cuenta del cliente cambió mientras se cobraba. Volvé a abrir el cobro e intentá de nuevo.');
      }
      aplicaciones = imputacion.aplicaciones;
      saldoRestante = redondear(saldoActual - importe);

      // ---------- Escrituras ----------
      const ultimo = contadorSnap.exists() ? (Number((contadorSnap.data() as any).valor) || 0) : 0;
      venta.nroTicket = ultimo + 1;
      venta.cuentaCorriente = {
        deudaCancelada: importe,
        descuento,
        saldoAnterior: saldoActual,
        saldoPosterior: saldoRestante,
        aplicaciones: aplicaciones.map(a => ({ nroTicket: a.nroTicket, fecha: a.fecha, importe: a.importe, pendienteNuevo: a.pendienteNuevo }))
      };
      tx.set(contadorRef, { valor: venta.nroTicket }, { merge: true });
      tx.set(ventaRef, venta);

      for (const a of aplicaciones) {
        const c = cargos.find(x => x.data.id === a.cargoId)!;
        const cobro: CobroDeCargo = { ventaId: ventaRef.id, nroTicket: venta.nroTicket, fecha: venta.fecha, importe: a.importe, anulado: false };
        tx.update(c.ref, {
          pendiente: a.pendienteNuevo,
          saldada: a.pendienteNuevo <= 0,
          cobros: [...(c.data.cobros || []), cobro]
        });
      }

      const pago: Omit<MovimientoCuenta, 'id'> = {
        tipo: 'pago',
        fecha: venta.fecha,
        importe,
        ventaId: ventaRef.id,
        nroTicket: venta.nroTicket,
        pagos,
        aplicaciones,
        cobrado,
        descuento,
        sucursalId: caja.sucursalId || null,
        cajaId: caja.id,
        usuario,
        cajero,
        saldoAnterior: saldoActual,
        saldoPosterior: saldoRestante,
        anulado: false
      };
      tx.set(pagoRef, pago);

      tx.update(cuentaRef, {
        saldo: saldoRestante,
        totalPagos: redondear(Number(cuenta.totalPagos) + importe),   // deuda cancelada (incluye descuentos)
        ultimoPago: venta.fecha,
        actualizada: serverTimestamp()
      });

      tx.update(cajaRef, { cantidadVentas: (Number(datosCaja.cantidadVentas) || 0) + 1 });

      if (registro) {
        registro.descripcion = `Ticket #${String(venta.nroTicket).padStart(8, '0')} - ${descripcionBase}`;
      }
      this.auditoria.registrarEnTransaccion(tx, registro);
    });

    return { venta: { ...venta, id: ventaRef.id }, saldoRestante, aplicaciones };
  }

  // =====================================================
  // ANULACIÓN DE TICKETS (la llama TicketsService.anular dentro de su transacción)
  // =====================================================

  /** ¿El ticket toca la cuenta corriente? (compra a cuenta o cobro de deuda) */
  static afectaCuenta(venta: any): boolean {
    return !!venta?.cliente?.id && (esCobroCuenta(venta) || aCuentaDeVenta(venta) > 0);
  }

  /** Fase de LECTURAS. Valida que se pueda anular; devuelve null si el ticket no toca la cuenta. */
  async leerAnulacion(tx: Transaction, venta: any): Promise<LecturaAnulacionCuenta | null> {
    if (!CuentaCorrienteService.afectaCuenta(venta)) return null;

    const clienteId = venta.cliente.id;
    const cuentaRef = this.refCuenta(clienteId);
    const movRef = this.refMovimiento(clienteId, venta.id);
    const cuentaSnap = await tx.get(cuentaRef);
    const movSnap = await tx.get(movRef);
    const cuenta: any = cuentaSnap.exists() ? cuentaSnap.data() : null;
    const mov: any = movSnap.exists() ? movSnap.data() : null;

    // Ya no existe o ya estaba anulado: no hay nada que revertir en la cuenta
    if (!cuenta || !mov || mov.anulado) return null;

    const base = { clienteId, nombreCliente: venta.cliente.nombre || cuenta.nombre || 'Cliente', cuentaRef, cuenta, movRef, mov };

    if (mov.tipo === 'cargo') {
      const importe = redondear(Number(mov.importe));
      const pendiente = redondear(Number(mov.pendiente));
      if (pendiente < importe - 0.009) {
        const tickets = (mov.cobros || [])
          .filter((c: CobroDeCargo) => !c.anulado)
          .map((c: CobroDeCargo) => '#' + String(c.nroTicket ?? '').padStart(8, '0'));
        throw new CuentaCorrienteError(
          `Esta compra a cuenta ya tiene pagos imputados (${this.moneda(importe - pendiente)}). ` +
          `Para anularla, primero anulá ${tickets.length > 1 ? 'los cobros' : 'el cobro'} ${tickets.join(', ')}.`);
      }
      return { ...base, tipo: 'cargo', importe, cargos: [] };
    }

    // Pago: hay que volver a dejar pendientes las compras que pagó
    const cargos: LecturaAnulacionCuenta['cargos'] = [];
    for (const a of (mov.aplicaciones || []) as Aplicacion[]) {
      const ref = this.refMovimiento(clienteId, a.cargoId);
      const snap = await tx.get(ref);
      if (snap.exists()) cargos.push({ ref, data: snap.data(), aplicado: redondear(Number(a.importe)) });
    }
    return { ...base, tipo: 'pago', importe: redondear(Number(mov.importe)), cargos };
  }

  /** Fase de ESCRITURAS */
  escribirAnulacion(tx: Transaction, l: LecturaAnulacionCuenta, ventaId: string, motivo: string, usuario: UsuarioRegistro): void {
    const marca = { anulado: true, motivoAnulacion: motivo, anuladoPor: usuario, anuladoEn: serverTimestamp() };
    const saldo = redondear(Number(l.cuenta.saldo));

    if (l.tipo === 'cargo') {
      tx.update(l.movRef, { ...marca, pendiente: 0, saldada: true });
      tx.update(l.cuentaRef, {
        saldo: redondear(Math.max(0, saldo - l.importe)),
        totalCompras: redondear(Math.max(0, Number(l.cuenta.totalCompras) - l.importe)),
        actualizada: serverTimestamp()
      });
      return;
    }

    for (const c of l.cargos) {
      if (c.data.anulado) continue;
      const pendiente = redondear(Math.min(Number(c.data.importe) || 0, (Number(c.data.pendiente) || 0) + c.aplicado));
      tx.update(c.ref, {
        pendiente,
        saldada: pendiente <= 0,
        cobros: (c.data.cobros || []).map((x: CobroDeCargo) => x.ventaId === ventaId ? { ...x, anulado: true } : x)
      });
    }
    tx.update(l.movRef, marca);
    tx.update(l.cuentaRef, {
      saldo: redondear(saldo + l.importe),
      totalPagos: redondear(Math.max(0, Number(l.cuenta.totalPagos) - l.importe)),
      actualizada: serverTimestamp()
    });
  }

  private moneda(n: number): string {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(Number(n) || 0);
  }
}
