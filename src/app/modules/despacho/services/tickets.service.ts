import { Injectable } from '@angular/core';
import { ordenesDeVenta, textoOrdenes } from './desglose-reparacion';
import {
  Firestore,
  collection,
  doc,
  query,
  where,
  getDoc,
  getDocs,
  limit,
  runTransaction,
  serverTimestamp
} from '@angular/fire/firestore';
import {
  DevolucionDeVenta, SeleccionDevolucion, devolucionesVigentes, renglonesDevolvibles, validarSeleccion,
  importeDevolucion, repartoDevolucion, totalDevuelto, METODOS_DEVOLUCION
} from './devoluciones';
import { AuditoriaService } from 'src/app/shared/services/auditoria.service';
import { nombreMetodo, aCuentaDeVenta } from './pagos';
import { CuentaCorrienteService, CuentaCorrienteError, LecturaAnulacionCuenta } from './cuenta-corriente.service';
import { EquiposService } from 'src/app/modules/admin/services/equipos.service';
import { nombreColor } from 'src/app/shared/utils/colores';
import { abrirVistaPrevia, imprimirEnPagina } from 'src/app/shared/utils/imprimir';
import { textoVencimiento } from './credito-casa';
import { CreditoError, CreditosService, LecturaAnulacionCuota } from './creditos.service';

/** Leyenda de validez del presupuesto (se puede cambiar acá) */
export const VALIDEZ_PRESUPUESTO = 'Precios válidos por el día de la fecha, sujetos a disponibilidad de stock.';

/** Datos para imprimir un presupuesto desde el carrito de Despacho */
export interface DatosPresupuesto {
  tipoPrecio: 'minorista' | 'mayorista';
  cliente?: string | null;
  items: {
    nombre: string; cantidad: number; precioUnitario: number; subtotal: number; color?: string | null; modelo?: string | null;
    sinDescuento?: boolean;   // equipos: no llevan descuento por efectivo / transferencia
    detalle?: string;         // equipos: color, grado, batería…
  }[];
  /** Medios con descuento (ej. efectivo 10%): se muestra cuánto queda abonando así */
  descuentos?: { medio: string; porcentaje: number }[];
  validez?: string;
  /** 🏠 Crédito de la casa con el plan elegido (sin el interés: solo montos y cuotas) */
  credito?: {
    precioEquipo: number;
    canje: number;
    canjeDetalle?: string;
    entrega: number;
    cuotas: { numero: number; importe: number; desde: string; hasta: string }[];
  } | null;
}

/** Error de negocio con mensaje para mostrar */
export class TicketError extends Error {
  constructor(message: string) {
    super(message);
  }
}

/** Resultado de una anulación (para avisar qué se revirtió) */
export interface ResultadoAnulacion {
  stockDevuelto: string[];         // productos a los que se les devolvió stock
  stockNoDevuelto: string[];       // productos que ya no existen
  puntosRevertidos: boolean;
  cuponDevuelto: boolean;
  cajaCerrada: boolean;            // la caja del ticket ya estaba cerrada
  ordenReparacion: string | null;  // si era un cobro de reparación: nº de orden(es) a las que se les descontó el cobro ("1234" o "1234, 1240")
  /** Si tocaba la cuenta corriente: 'cargo' = se descontó la deuda; 'pago' = la deuda volvió a quedar pendiente */
  cuentaCorriente: { tipo: 'cargo' | 'pago'; cliente: string; importe: number } | null;
  /** Equipos que volvieron a estar a la venta */
  equiposDevueltos: string[];
  /** 🏠 Si era una venta con crédito de la casa: el crédito quedó anulado */
  creditoAnulado?: boolean;
  /** 📲 Equipo del plan canje que se dio de baja (se le devuelve al cliente) */
  canjeDevuelto?: string | null;
  /** 🔁 Si era una refinanciación: el crédito nuevo se anuló y el viejo volvió a quedar vigente */
  refinanciacionDeshecha?: boolean;
  /** 🏠 Si era un cobro de cuotas: qué cuotas volvieron a quedar pendientes (ej. "2, 3") */
  cuotasRevertidas?: string | null;
}

/**
 * Tickets de venta del local (colección 'Ventas').
 *  - Número correlativo: 'Contador Tickets/general' (se asigna dentro de la transacción de la venta).
 *  - Vista previa / impresión del ticket de 80 mm.
 *  - Búsqueda por número, fecha y cliente.
 *  - Anulación: devuelve stock, revierte puntos y cupón. La venta no se borra.
 */
@Injectable({ providedIn: 'root' })
export class TicketsService {

  static readonly CONTADOR = 'Contador Tickets';
  static readonly CONTADOR_ID = 'general';

  constructor(
    private firestore: Firestore,
    private auditoria: AuditoriaService,
    private cuentas: CuentaCorrienteService,
    private equipos: EquiposService,
    private creditos: CreditosService
  ) { }

  /** Referencia al contador de tickets (para usar dentro de la transacción de la venta) */
  refContador() {
    return doc(this.firestore, TicketsService.CONTADOR, TicketsService.CONTADOR_ID);
  }

  numeroFormateado(venta: any): string {
    return venta?.nroTicket ? String(venta.nroTicket).padStart(8, '0') : 'S/N';
  }

  // =====================================================
  // BÚSQUEDA
  // =====================================================

  async buscarPorNumero(nro: number): Promise<any[]> {
    const snap = await getDocs(query(collection(this.firestore, 'Ventas'), where('nroTicket', '==', nro)));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  async buscarEntreFechas(inicio: Date, fin: Date): Promise<any[]> {
    const snap = await getDocs(query(
      collection(this.firestore, 'Ventas'),
      where('fecha', '>=', inicio.toISOString()),
      where('fecha', '<=', fin.toISOString())
    ));
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() } as any))
      .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  }

  // =====================================================
  // ANULACIÓN
  // =====================================================

  /**
   * Anula un ticket en una sola transacción:
   *  - marca la venta como anulada (motivo, usuario, fecha),
   *  - devuelve el stock a donde se descontó,
   *  - revierte los puntos del cliente (los usados vuelven, los ganados se descuentan),
   *  - devuelve el uso del cupón,
   *  - si la caja del ticket sigue abierta, cuenta la anulación (control del cierre).
   */
  async anular(venta: any, motivo: string): Promise<ResultadoAnulacion> {
    const usuario = this.auditoria.getUsuarioActual();
    if (!usuario) throw new TicketError('No se pudo identificar al usuario. Volvé a iniciar sesión.');
    if (!venta?.id) throw new TicketError('Ticket inválido.');
    if (!motivo || motivo.trim().length < 3) throw new TicketError('Ingresá el motivo de la anulación.');

    // ↩ Nota de devolución: se anula aparte (el stock vuelve a salir y se repone la deuda / la plata)
    if (venta.tipoVenta === 'devolucion') return this.anularDevolucion(venta, motivo.trim());

    const ventaRef = doc(this.firestore, 'Ventas', venta.id);
    const cajaRef = venta.cajaId ? doc(this.firestore, 'Cajas', venta.cajaId) : null;
    const clienteRef = venta.cliente?.id && (venta.puntosUsados > 0 || venta.puntosGanados > 0)
      ? doc(this.firestore, 'Clientes', venta.cliente.id)
      : null;
    const cuponRef = venta.cupon?.id ? doc(this.firestore, 'Cupones', venta.cupon.id) : null;

    // Productos únicos del ticket
    const idsProductos = [...new Set<string>((venta.items || []).map((i: any) => i.productoId).filter(Boolean))];

    const registro = await this.auditoria.armarRegistro({
      accion: 'anular',
      entidad: 'Ventas',
      entidadId: venta.id,
      descripcion: `Anuló el ticket #${this.numeroFormateado(venta)} por $${Number(venta.total || 0).toFixed(2)}. Motivo: ${motivo.trim()}`,
      extra: {
        nroTicket: venta.nroTicket ?? null,
        total: venta.total ?? null,
        cliente: venta.cliente?.nombre ?? null,
        items: (venta.items || []).map((i: any) => `${i.cantidad} x ${i.nombre}`)
      }
    });

    const esReparacion = venta.tipoVenta === 'reparacion' && !!venta.orden?.id;
    // Una o varias órdenes (un ticket puede cobrar varias del mismo cliente)
    const refsOrden = esReparacion
      ? ordenesDeVenta(venta).flatMap(o => ['Ordenes Pendientes', 'Ordenes Finalizadas'].map(col => doc(this.firestore, col, o.id)))
      : [];

    const vacio = (): ResultadoAnulacion => ({
      stockDevuelto: [], stockNoDevuelto: [], puntosRevertidos: false, cuponDevuelto: false, cajaCerrada: false, ordenReparacion: null,
      cuentaCorriente: null,
      equiposDevueltos: [],
      canjeDevuelto: null,
      creditoAnulado: false,
      cuotasRevertidas: null
    });
    // 🏠 Crédito de la casa: se anula junto con el ticket, solo si no tiene cuotas pagadas
    // 🔁 Refinanciación: se anula el crédito nuevo y el viejo vuelve a quedar vigente
    const idCreditoTicket = venta.credito?.creditoId || (venta.tipoVenta === 'refinanciacion' ? venta.refinanciacion?.creditoNuevoId : null);
    const creditoRef = idCreditoTicket ? doc(this.firestore, 'Creditos', idCreditoTicket) : null;
    const creditoViejoRef = venta.tipoVenta === 'refinanciacion' && venta.refinanciacion?.creditoAnterior?.id
      ? doc(this.firestore, 'Creditos', venta.refinanciacion.creditoAnterior.id) : null;
    let resultado: ResultadoAnulacion = vacio();

    await runTransaction(this.firestore, async (tx) => {
      resultado = vacio();

      // ---------- Lecturas ----------
      const ventaSnap = await tx.get(ventaRef);
      if (!ventaSnap.exists()) throw new TicketError('El ticket no existe.');
      const actual: any = ventaSnap.data();
      if (actual.anulada === true) {
        const quien = actual.anuladaPor?.nombre || actual.anuladaPor?.usuario || 'otro usuario';
        throw new TicketError(`Este ticket ya fue anulado por ${quien}.`);
      }
      const conDevolucion = devolucionesVigentes(actual);
      if (conDevolucion.length) {
        throw new TicketError(`Este ticket tiene ${conDevolucion.length > 1 ? 'devoluciones' : 'una devolución'} ` +
          `(${conDevolucion.map(d => '#' + String(d.nroTicket ?? '').padStart(8, '0')).join(', ')}). ` +
          'Para anularlo, primero anulá ' + (conDevolucion.length > 1 ? 'esas notas de devolución.' : 'esa nota de devolución.'));
      }

      const productos = new Map<string, { ref: any; data: any }>();
      for (const id of idsProductos) {
        const ref = doc(this.firestore, 'productos', id);
        const snap = await tx.get(ref);
        if (snap.exists()) productos.set(id, { ref, data: snap.data() });
      }
      const cajaSnap = cajaRef ? await tx.get(cajaRef) : null;
      const clienteSnap = clienteRef ? await tx.get(clienteRef) : null;
      const cuponSnap = cuponRef ? await tx.get(cuponRef) : null;
      const ordenesSnap = [];
      for (const ref of refsOrden) {
        ordenesSnap.push({ ref, snap: await tx.get(ref) });
      }
      // Equipos vendidos en este ticket: vuelven a estar a la venta
      const lecturasEquipos: { item: any; ref: any; data: any; imeiRef: any; imeiData: any }[] = [];
      for (const item of (actual.items || []).filter((i: any) => i.tipo === 'equipo' && i.equipoId)) {
        const ref = this.equipos.refEquipo(item.equipoId);
        const snap = await tx.get(ref);
        const data: any = snap.exists() ? snap.data() : null;
        const imei = data?.imei || item.equipo?.imei || '';
        const imeiRef = imei ? this.equipos.refIndiceImei(imei) : null;
        const imeiSnap = imeiRef ? await tx.get(imeiRef) : null;
        lecturasEquipos.push({ item, ref, data, imeiRef, imeiData: imeiSnap?.exists() ? imeiSnap.data() : null });
      }
      for (const l of lecturasEquipos) {
        // Mientras tanto cargaron otro equipo disponible con el mismo IMEI: no puede haber dos
        if (l.data?.estado === 'vendido' && l.data?.venta?.ventaId === venta.id && l.imeiData && l.imeiData.equipoId !== l.item.equipoId) {
          throw new TicketError(`No se puede anular: ya hay otro equipo disponible con el IMEI ${l.data.imei}. ` +
            'Revisalo en Gestiones → Equipos.');
        }
      }

      // 📲 Plan canje: el equipo que entregó el cliente se da de baja (se le devuelve). Si ya se vendió, no se puede.
      const canjeId: string | null = actual.canje?.equipoId || null;
      const canjeRef = canjeId ? this.equipos.refEquipo(canjeId) : null;
      const canjeSnap = canjeRef ? await tx.get(canjeRef) : null;
      const equipoCanje: any = canjeSnap?.exists() ? canjeSnap.data() : null;
      const imeiCanjeRef = equipoCanje?.imei ? this.equipos.refIndiceImei(equipoCanje.imei) : null;
      const imeiCanjeSnap = imeiCanjeRef ? await tx.get(imeiCanjeRef) : null;
      if (equipoCanje?.estado === 'vendido') {
        throw new TicketError(`No se puede anular: el equipo que entregó en el plan canje (${equipoCanje.modelo || 'equipo'}, IMEI ${equipoCanje.imei}) ` +
          'ya se vendió. Resolvelo a mano con el cliente.');
      }

      // 🏠 Crédito de la casa
      const creditoSnap = creditoRef ? await tx.get(creditoRef) : null;
      const credito: any = creditoSnap?.exists() ? creditoSnap.data() : null;
      if (credito && credito.estado !== 'anulado' && (Number(credito.pagado) || 0) > 0.004) {
        throw new TicketError(`No se puede anular: el crédito de la casa ya tiene ${'$'}${(Number(credito.pagado) || 0).toFixed(2)} pagados. ` +
          'Primero hay que anular los pagos de las cuotas.');
      }
      if (credito && credito.estado === 'refinanciado') {
        throw new TicketError('No se puede anular: ese crédito se refinanció después. Primero anulá la refinanciación.');
      }
      const creditoViejoSnap = creditoViejoRef ? await tx.get(creditoViejoRef) : null;
      const creditoViejo: any = creditoViejoSnap?.exists() ? creditoViejoSnap.data() : null;

      // 🏠 Cobro de cuotas: las cuotas que pagó vuelven a quedar pendientes
      let lecturaCuota: LecturaAnulacionCuota | null = null;
      try {
        lecturaCuota = await this.creditos.leerAnulacion(tx, { ...actual, id: venta.id });
      } catch (e) {
        if (e instanceof CreditoError) throw new TicketError(e.message);
        throw e;
      }

      // Cuenta corriente: compra a cuenta (se descuenta la deuda) o cobro de deuda (vuelve a quedar pendiente)
      let lecturaCuenta: LecturaAnulacionCuenta | null = null;
      try {
        lecturaCuenta = await this.cuentas.leerAnulacion(tx, { ...actual, id: venta.id });
      } catch (e) {
        if (e instanceof CuentaCorrienteError) throw new TicketError(e.message);
        throw e;
      }

      // ---------- Stock ----------
      const cambiosStock = new Map<string, any>();
      for (const item of (actual.items || [])) {
        // Los cobros de reparación no tienen stock
        if (item.tipo === 'reparacion' || !item.productoId) continue;

        const prod = productos.get(item.productoId);
        if (!prod) {
          resultado.stockNoDevuelto.push(item.nombre);
          continue;
        }
        const data = prod.data;
        const sd = item.stockDescontado;
        const cantidad = Number(item.cantidad) || 0;

        if (sd?.tipo === 'mayorista') {
          data.stockMayorista = (Number(data.stockMayorista) || 0) + (Number(sd.cantidad) || cantidad);
          cambiosStock.set(item.productoId, { ...(cambiosStock.get(item.productoId) || {}), stockMayorista: data.stockMayorista });
        } else {
          // minorista: se devuelve a la(s) sucursal(es) de donde salió
          const sucursales = this.normalizarStockSucursales(data.stockSucursales);
          const devoluciones = sd?.sucursales?.length
            ? sd.sucursales
            : [{ sucursalId: actual.sucursalId, cantidad }];
          for (const dev of devoluciones) {
            const entrada = sucursales.find(s => s.sucursalId === dev.sucursalId);
            if (entrada) entrada.cantidad = (Number(entrada.cantidad) || 0) + (Number(dev.cantidad) || 0);
            else sucursales.push({ sucursalId: dev.sucursalId, cantidad: Number(dev.cantidad) || 0 });
          }
          data.stockSucursales = sucursales;
          cambiosStock.set(item.productoId, { ...(cambiosStock.get(item.productoId) || {}), stockSucursales: sucursales });
        }
        resultado.stockDevuelto.push(item.nombre);
      }

      // ---------- Escrituras ----------
      tx.update(ventaRef, {
        anulada: true,
        motivoAnulacion: motivo.trim(),
        anuladaPor: usuario,
        anuladaEn: serverTimestamp()
      });

      for (const [id, cambios] of cambiosStock) {
        tx.update(productos.get(id)!.ref, cambios);
      }

      // Puntos: vuelven los usados y se descuentan los ganados
      if (clienteRef && clienteSnap?.exists()) {
        const puntosActuales = Number((clienteSnap.data() as any).puntos) || 0;
        const nuevos = Math.max(0, puntosActuales + (Number(actual.puntosUsados) || 0) - (Number(actual.puntosGanados) || 0));
        tx.update(clienteRef, { puntos: nuevos });
        resultado.puntosRevertidos = true;
      }

      // Cupón: se devuelve el uso (si se había agotado por este uso, se reactiva)
      if (cuponRef && cuponSnap?.exists()) {
        const c: any = cuponSnap.data();
        const disponible = Number(c.cantidadDisponible) || 0;
        const cambios: any = { cantidadDisponible: disponible + 1 };
        if (c.activo === false && disponible <= 0) cambios.activo = true;
        tx.update(cuponRef, cambios);
        resultado.cuponDevuelto = true;
      }

      // Caja: si sigue abierta, se cuenta la anulación (el cierre lo controla)
      if (cajaRef && cajaSnap?.exists()) {
        const datosCaja: any = cajaSnap.data();
        if (datosCaja.abierta === false) {
          resultado.cajaCerrada = true;
        } else {
          tx.update(cajaRef, { cantidadAnulaciones: (Number(datosCaja.cantidadAnulaciones) || 0) + 1 });
        }
      }

      // Cobro de reparación: se descuenta de la(s) orden(es) (el saldo vuelve a quedar pendiente)
      const numerosRevertidos: string[] = [];
      for (const { ref, snap } of ordenesSnap) {
        if (!snap.exists()) continue;
        const orden: any = snap.data();
        const cobros = (orden.cobros || []).map((c: any) => c.ventaId === venta.id ? { ...c, anulado: true } : c);
        const totalPagado = Math.round(cobros
          .filter((c: any) => !c.anulado)
          .reduce((a: number, c: any) => a + (Number(c.monto) || 0), 0) * 100) / 100;
        tx.update(ref, {
          cobros,
          totalPagado,
          pagada: totalPagado >= (Number(orden.presupuesto) || 0) && totalPagado > 0
        });
        numerosRevertidos.push(String(orden.numeroOrden ?? '?'));
      }
      if (numerosRevertidos.length) resultado.ordenReparacion = numerosRevertidos.join(', #');

      // Equipos: vuelven a "disponible" (si siguen marcados como vendidos por ESTE ticket)
      for (const l of lecturasEquipos) {
        if (!l.data || l.data.estado !== 'vendido' || l.data.venta?.ventaId !== venta.id) continue;
        tx.update(l.ref, {
          estado: 'disponible',
          venta: null,
          ventasAnuladas: [...(l.data.ventasAnuladas || []), {
            ventaId: venta.id,
            nroTicket: actual.nroTicket ?? null,
            fecha: actual.fecha || null,
            anuladaEn: new Date().toISOString(),
            motivo: motivo.trim()
          }]
        });
        if (l.imeiRef) tx.set(l.imeiRef, { equipoId: l.item.equipoId, modelo: l.data.modelo || l.item.equipo?.modelo || '' });
        resultado.equiposDevueltos.push(`${l.item.nombre} (IMEI ${l.data.imei})`);
      }

      if (canjeRef && canjeId && equipoCanje) {
        tx.set(this.equipos.refEliminado(canjeId), {
          ...equipoCanje,
          id: canjeId,
          eliminado: {
            fecha: new Date().toISOString(),
            usuario,
            motivo: `Anulación del ticket ${this.numeroFormateado(venta)}: se le devolvió al cliente. ${motivo.trim()}`
          }
        });
        tx.delete(canjeRef);
        if (imeiCanjeRef && imeiCanjeSnap?.exists() && (imeiCanjeSnap.data() as any)?.equipoId === canjeId) tx.delete(imeiCanjeRef);
        resultado.canjeDevuelto = [equipoCanje.modelo, equipoCanje.capacidad].filter(Boolean).join(' ') + ` (IMEI ${equipoCanje.imei})`;
      }

      if (creditoRef && credito && credito.estado !== 'anulado') {
        tx.update(creditoRef, {
          estado: 'anulado',
          bloqueo: null,
          anulado: { fecha: new Date().toISOString(), usuario, motivo: motivo.trim(), por: 'ticket' }
        });
        resultado.creditoAnulado = true;
      }
      if (creditoViejoRef && creditoViejo && creditoViejo.estado === 'refinanciado' &&
          creditoViejo.refinanciado?.creditoNuevoId === idCreditoTicket) {
        tx.update(creditoViejoRef, { estado: 'vigente', refinanciado: null });
        resultado.refinanciacionDeshecha = true;
      }

      if (lecturaCuota) {
        this.creditos.escribirAnulacion(tx, lecturaCuota, motivo.trim(), usuario);
        resultado.cuotasRevertidas = (lecturaCuota.pago.aplicaciones || []).map((a: any) => a.numero).join(', ');
      }

      if (lecturaCuenta) {
        this.cuentas.escribirAnulacion(tx, lecturaCuenta, venta.id, motivo.trim(), usuario);
        resultado.cuentaCorriente = { tipo: lecturaCuenta.tipo, cliente: lecturaCuenta.nombreCliente, importe: lecturaCuenta.importe };
      }

      this.auditoria.registrarEnTransaccion(tx, registro);
    });

    return resultado;
  }

  // =====================================================
  // ↩ DEVOLUCIÓN PARCIAL DE PRODUCTOS
  // =====================================================

  /** Caja abierta de una sucursal (para devolver la plata). null si no hay ninguna. */
  async cajaAbiertaDe(sucursalId: string): Promise<any | null> {
    if (!sucursalId) return null;
    const snap = await getDocs(query(collection(this.firestore, 'Cajas'),
      where('sucursalId', '==', sucursalId), where('abierta', '==', true), limit(1)));
    return snap.docs.length ? { id: snap.docs[0].id, ...snap.docs[0].data() } : null;
  }

  /** Lo que todavía debe de esa compra a cuenta corriente (0 si no compró a cuenta o ya lo pagó) */
  async pendienteCuentaDe(venta: any): Promise<number> {
    if (!venta?.cliente?.id || !(aCuentaDeVenta(venta) > 0)) return 0;
    const snap = await getDoc(this.cuentas.refMovimiento(venta.cliente.id, venta.id));
    const mov: any = snap.exists() ? snap.data() : null;
    return mov && !mov.anulado ? Math.max(0, Number(mov.pendiente) || 0) : 0;
  }

  /**
   * Devuelve productos de un ticket: crea la nota de devolución (ticket con importes negativos),
   * repone el stock y descuenta de la cuenta corriente (si compró a cuenta) o registra la plata que se devuelve.
   * @param caja caja donde sale la plata (la abierta en Despacho; si no se pasa, la abierta de la sucursal del ticket)
   */
  async devolver(
    venta: any,
    seleccion: SeleccionDevolucion[],
    datos: { importe: number; metodo: string | null; motivo: string; cajero?: any | null },
    caja: any | null = null
  ): Promise<{ nota: any; aCuenta: number; dinero: number; stockDevuelto: string[] }> {
    const usuario = this.auditoria.getUsuarioActual();
    if (!usuario) throw new TicketError('No se pudo identificar al usuario. Volvé a iniciar sesión.');
    if (!venta?.id) throw new TicketError('Ticket inválido.');
    const motivo = String(datos?.motivo || '').trim();
    if (motivo.length < 3) throw new TicketError('Ingresá el motivo de la devolución.');
    const v0 = validarSeleccion(venta, seleccion);
    if (!v0.items) throw new TicketError(v0.error || 'Revisá lo que devuelve.');
    const importePedido = Math.round((Number(datos.importe) || 0) * 100) / 100;
    if (!(importePedido > 0)) throw new TicketError('El importe a devolver tiene que ser mayor a 0.');

    // Caja: la que se pasó o la abierta de la sucursal del ticket
    const cajaUsada = caja?.id ? caja : await this.cajaAbiertaDe(venta.sucursalId);

    const ventaRef = doc(this.firestore, 'Ventas', venta.id);
    const notaRef = doc(collection(this.firestore, 'Ventas'));
    const contadorRef = this.refContador();
    const cajaRef = cajaUsada?.id ? doc(this.firestore, 'Cajas', cajaUsada.id) : null;
    const clienteId: string | null = venta.cliente?.id || null;
    const cuentaRef = clienteId && aCuentaDeVenta(venta) > 0 ? this.cuentas.refCuenta(clienteId) : null;
    const movRef = clienteId && aCuentaDeVenta(venta) > 0 ? this.cuentas.refMovimiento(clienteId, venta.id) : null;
    const idsProductos = [...new Set<string>(v0.items.map(s => venta.items[s.indice]?.productoId).filter(Boolean))];

    let nota: any = null;
    let aCuenta = 0;
    let dinero = 0;
    const stockDevuelto: string[] = [];

    await runTransaction(this.firestore, async (tx) => {
      // ---------- Lecturas ----------
      const ventaSnap = await tx.get(ventaRef);
      if (!ventaSnap.exists()) throw new TicketError('El ticket no existe.');
      const actual: any = { id: venta.id, ...ventaSnap.data() };
      const contadorSnap = await tx.get(contadorRef);
      const cajaSnap = cajaRef ? await tx.get(cajaRef) : null;
      const cuentaSnap = cuentaRef ? await tx.get(cuentaRef) : null;
      const movSnap = movRef ? await tx.get(movRef) : null;
      const productos = new Map<string, { ref: any; data: any }>();
      for (const id of idsProductos) {
        const ref = doc(this.firestore, 'productos', id);
        const snap = await tx.get(ref);
        if (snap.exists()) productos.set(id, { ref, data: snap.data() });
      }

      // ---------- Validaciones con los datos actuales ----------
      const v = validarSeleccion(actual, seleccion);
      if (!v.items) throw new TicketError(v.error || 'Revisá lo que devuelve.');
      const maximo = importeDevolucion(actual, v.items);
      if (importePedido > maximo + 0.009) {
        throw new TicketError(`El importe supera lo que pagó por esos productos (${this.moneda(maximo)}).`);
      }
      const mov: any = movSnap?.exists() ? movSnap.data() : null;
      const pendiente = mov && !mov.anulado ? Math.max(0, Number(mov.pendiente) || 0) : 0;
      const reparto = repartoDevolucion(actual, importePedido, pendiente);
      aCuenta = reparto.aCuenta;
      dinero = reparto.dinero;

      const metodo = dinero > 0 ? String(datos.metodo || '') : null;
      if (dinero > 0 && !METODOS_DEVOLUCION.includes(metodo as any)) {
        throw new TicketError('Elegí con qué medio se le devuelve la plata.');
      }
      const datosCaja: any = cajaSnap?.exists() ? cajaSnap.data() : null;
      if (dinero > 0 && (!datosCaja || datosCaja.abierta === false)) {
        throw new TicketError('Para devolver plata tiene que haber una caja abierta en la sucursal. Abrí la caja y volvé a intentar.');
      }

      // ---------- Renglones de la nota y stock ----------
      const renglones = new Map(renglonesDevolvibles(actual).map(r => [r.indice, r]));
      const cambiosStock = new Map<string, any>();
      const itemsNota: any[] = [];
      const itemsDevolucion: DevolucionDeVenta['items'] = [];
      // El importe se reparte entre los renglones en proporción a su precio (el último se lleva el redondeo)
      const bruto = v.items.reduce((a, s) => a + renglones.get(s.indice)!.precioNeto * s.cantidad, 0);
      let repartido = 0;
      v.items.forEach((s, i) => {
        const item = actual.items[s.indice];
        const r = renglones.get(s.indice)!;
        const imp = i < v.items!.length - 1
          ? Math.round(importePedido * (r.precioNeto * s.cantidad) / (bruto || 1) * 100) / 100
          : Math.round((importePedido - repartido) * 100) / 100;
        repartido = Math.round((repartido + imp) * 100) / 100;

        // Stock: vuelve a donde se descontó (los cargados a mano no tienen stock)
        let stockVuelto: any = null;
        const sd = item.stockDescontado;
        const prod = item.productoId ? productos.get(item.productoId) : null;
        if (prod && sd && !item.manual) {
          const data = prod.data;
          if (sd.tipo === 'mayorista') {
            data.stockMayorista = (Number(data.stockMayorista) || 0) + s.cantidad;
            cambiosStock.set(item.productoId, { ...(cambiosStock.get(item.productoId) || {}), stockMayorista: data.stockMayorista });
            stockVuelto = { tipo: 'mayorista', cantidad: s.cantidad };
          } else {
            const sucursalId = sd.sucursales?.[0]?.sucursalId || actual.sucursalId;
            const sucursales = this.normalizarStockSucursales(data.stockSucursales);
            const entrada = sucursales.find(x => x.sucursalId === sucursalId);
            if (entrada) entrada.cantidad = (Number(entrada.cantidad) || 0) + s.cantidad;
            else sucursales.push({ sucursalId, cantidad: s.cantidad });
            data.stockSucursales = sucursales;
            cambiosStock.set(item.productoId, { ...(cambiosStock.get(item.productoId) || {}), stockSucursales: sucursales });
            stockVuelto = { tipo: 'minorista', sucursalId, cantidad: s.cantidad };
          }
          stockDevuelto.push(item.nombre);
        }

        itemsNota.push({
          productoId: item.productoId || null,
          manual: item.manual === true,
          nombre: item.nombre,
          color: item.color || null,
          modelo: item.modelo || null,
          tipo: 'devolucion',
          indiceOriginal: s.indice,
          cantidad: -s.cantidad,
          precioUnitario: r.precioNeto,
          subtotal: -imp,
          stockDevuelto: stockVuelto
        });
        itemsDevolucion.push({ indice: s.indice, cantidad: s.cantidad, importe: imp });
      });

      // ---------- Nota de devolución (importes negativos: la caja y los reportes la descuentan) ----------
      const pagos: any[] = [];
      if (aCuenta > 0) pagos.push({ metodo: 'cuentacorriente', monto: -aCuenta });
      if (dinero > 0) pagos.push({ metodo, monto: -dinero });
      const ultimo = contadorSnap.exists() ? (Number((contadorSnap.data() as any).valor) || 0) : 0;
      const fecha = new Date().toISOString();
      nota = {
        fecha,
        tipoVenta: 'devolucion',
        tipoPrecio: actual.tipoPrecio || 'minorista',
        cliente: actual.cliente || null,
        ventaOriginal: { id: venta.id, nroTicket: actual.nroTicket ?? null, fecha: actual.fecha || null },
        items: itemsNota,
        subtotal: -importePedido,
        total: -importePedido,
        metodoPago: pagos.length === 1 ? pagos[0].metodo : 'mixto',
        pagos,
        motivoDevolucion: motivo,
        sucursalId: datosCaja?.sucursalId || cajaUsada?.sucursalId || actual.sucursalId || null,
        cajaId: dinero > 0 || datosCaja ? (cajaUsada?.id || null) : null,
        usuario,
        cajero: datos.cajero || null,
        nroTicket: ultimo + 1
      };

      // ---------- Escrituras ----------
      tx.set(contadorRef, { valor: nota.nroTicket }, { merge: true });
      tx.set(notaRef, nota);
      const devolucion: DevolucionDeVenta = {
        ventaId: notaRef.id, nroTicket: nota.nroTicket, fecha, items: itemsDevolucion, importe: importePedido, aCuenta
      };
      const devoluciones = [...(Array.isArray(actual.devoluciones) ? actual.devoluciones : []), devolucion];
      tx.update(ventaRef, { devoluciones, totalDevuelto: totalDevuelto({ devoluciones }) });
      for (const [id, cambios] of cambiosStock) tx.update(productos.get(id)!.ref, cambios);
      if (aCuenta > 0 && movRef && cuentaRef) {
        const cuenta: any = cuentaSnap?.exists() ? cuentaSnap.data() : {};
        const nuevoPendiente = Math.round((pendiente - aCuenta) * 100) / 100;
        tx.update(movRef, {
          pendiente: nuevoPendiente,
          saldada: nuevoPendiente <= 0.004,
          devuelto: Math.round(((Number(mov.devuelto) || 0) + aCuenta) * 100) / 100
        });
        tx.update(cuentaRef, {
          saldo: Math.round(Math.max(0, (Number(cuenta.saldo) || 0) - aCuenta) * 100) / 100,
          totalCompras: Math.round(Math.max(0, (Number(cuenta.totalCompras) || 0) - aCuenta) * 100) / 100,
          actualizada: serverTimestamp()
        });
      }
      if (cajaRef && datosCaja && nota.cajaId) {
        tx.update(cajaRef, { cantidadVentas: (Number(datosCaja.cantidadVentas) || 0) + 1 });
      }
    });

    this.auditoria.registrar({
      accion: 'modificar',
      entidad: 'Ventas',
      entidadId: venta.id,
      descripcion: `Devolución de productos del ticket #${this.numeroFormateado(venta)}: ${this.moneda(importePedido)}` +
        (aCuenta > 0 ? ` (${this.moneda(aCuenta)} descontado de la cuenta corriente)` : '') +
        (dinero > 0 ? ` (${this.moneda(dinero)} devuelto en ${nombreMetodo(datos.metodo)})` : '') +
        ` · nota #${String(nota.nroTicket).padStart(8, '0')} · Motivo: ${motivo}`
    });

    return { nota: { ...nota, id: notaRef.id }, aCuenta, dinero, stockDevuelto };
  }

  /** Anula una nota de devolución: el stock vuelve a salir, se repone la deuda y la devolución sale del ticket original */
  private async anularDevolucion(nota: any, motivo: string): Promise<ResultadoAnulacion> {
    const usuario = this.auditoria.getUsuarioActual();
    const notaRef = doc(this.firestore, 'Ventas', nota.id);
    const originalId: string | null = nota.ventaOriginal?.id || null;
    const originalRef = originalId ? doc(this.firestore, 'Ventas', originalId) : null;
    const cajaRef = nota.cajaId ? doc(this.firestore, 'Cajas', nota.cajaId) : null;
    const aCuenta = Math.round(Math.max(0, -(nota.pagos || []).filter((p: any) => p.metodo === 'cuentacorriente')
      .reduce((a: number, p: any) => a + (Number(p.monto) || 0), 0)) * 100) / 100;
    const clienteId = nota.cliente?.id || null;
    const cuentaRef = aCuenta > 0 && clienteId && originalId ? this.cuentas.refCuenta(clienteId) : null;
    const movRef = aCuenta > 0 && clienteId && originalId ? this.cuentas.refMovimiento(clienteId, originalId) : null;
    const idsProductos = [...new Set<string>((nota.items || []).map((i: any) => i.productoId).filter(Boolean))];

    const resultado: ResultadoAnulacion = {
      stockDevuelto: [], stockNoDevuelto: [], puntosRevertidos: false, cuponDevuelto: false, cajaCerrada: false,
      ordenReparacion: null, cuentaCorriente: null, equiposDevueltos: [], canjeDevuelto: null, creditoAnulado: false, cuotasRevertidas: null
    };

    await runTransaction(this.firestore, async (tx) => {
      const notaSnap = await tx.get(notaRef);
      if (!notaSnap.exists()) throw new TicketError('La nota de devolución no existe.');
      const actual: any = notaSnap.data();
      if (actual.anulada === true) throw new TicketError('Esta nota de devolución ya está anulada.');
      const originalSnap = originalRef ? await tx.get(originalRef) : null;
      const cajaSnap = cajaRef ? await tx.get(cajaRef) : null;
      const cuentaSnap = cuentaRef ? await tx.get(cuentaRef) : null;
      const movSnap = movRef ? await tx.get(movRef) : null;
      const productos = new Map<string, { ref: any; data: any }>();
      for (const id of idsProductos) {
        const ref = doc(this.firestore, 'productos', id);
        const snap = await tx.get(ref);
        if (snap.exists()) productos.set(id, { ref, data: snap.data() });
      }

      // Stock: vuelve a salir (lo que entró con la devolución)
      const cambiosStock = new Map<string, any>();
      for (const item of actual.items || []) {
        const sv = item.stockDevuelto;
        const prod = item.productoId ? productos.get(item.productoId) : null;
        if (!sv || !prod) continue;
        const cant = Number(sv.cantidad) || 0;
        if (sv.tipo === 'mayorista') {
          prod.data.stockMayorista = (Number(prod.data.stockMayorista) || 0) - cant;
          cambiosStock.set(item.productoId, { ...(cambiosStock.get(item.productoId) || {}), stockMayorista: prod.data.stockMayorista });
        } else {
          const sucursales = this.normalizarStockSucursales(prod.data.stockSucursales);
          const entrada = sucursales.find(x => x.sucursalId === sv.sucursalId);
          if (entrada) entrada.cantidad = (Number(entrada.cantidad) || 0) - cant;
          else sucursales.push({ sucursalId: sv.sucursalId, cantidad: -cant });
          prod.data.stockSucursales = sucursales;
          cambiosStock.set(item.productoId, { ...(cambiosStock.get(item.productoId) || {}), stockSucursales: sucursales });
        }
        resultado.stockDevuelto.push(item.nombre);
      }

      // ---------- Escrituras ----------
      tx.update(notaRef, { anulada: true, motivoAnulacion: motivo, anuladaPor: usuario, anuladaEn: serverTimestamp() });
      if (originalSnap?.exists()) {
        const original: any = originalSnap.data();
        const devoluciones = (original.devoluciones || []).map((d: any) => d.ventaId === nota.id ? { ...d, anulada: true } : d);
        tx.update(originalRef!, { devoluciones, totalDevuelto: totalDevuelto({ devoluciones }) });
      }
      for (const [id, cambios] of cambiosStock) tx.update(productos.get(id)!.ref, cambios);
      const mov: any = movSnap?.exists() ? movSnap.data() : null;
      if (aCuenta > 0 && mov && !mov.anulado && cuentaSnap?.exists()) {
        const cuenta: any = cuentaSnap.data();
        const pendiente = Math.round(Math.min(Number(mov.importe) || 0, (Number(mov.pendiente) || 0) + aCuenta) * 100) / 100;
        tx.update(movRef!, {
          pendiente,
          saldada: pendiente <= 0.004,
          devuelto: Math.round(Math.max(0, (Number(mov.devuelto) || 0) - aCuenta) * 100) / 100
        });
        tx.update(cuentaRef!, {
          saldo: Math.round(((Number(cuenta.saldo) || 0) + aCuenta) * 100) / 100,
          totalCompras: Math.round(((Number(cuenta.totalCompras) || 0) + aCuenta) * 100) / 100,
          actualizada: serverTimestamp()
        });
        resultado.cuentaCorriente = { tipo: 'pago', cliente: nota.cliente?.nombre || 'el cliente', importe: aCuenta };
      }
      if (cajaRef && cajaSnap?.exists()) {
        const datosCaja: any = cajaSnap.data();
        if (datosCaja.abierta === false) resultado.cajaCerrada = true;
        else tx.update(cajaRef, { cantidadAnulaciones: (Number(datosCaja.cantidadAnulaciones) || 0) + 1 });
      }
    });

    this.auditoria.registrar({
      accion: 'anular', entidad: 'Ventas', entidadId: nota.id,
      descripcion: `Anuló la nota de devolución #${this.numeroFormateado(nota)} (ticket #${String(nota.ventaOriginal?.nroTicket ?? '').padStart(8, '0')}) ` +
        `por ${this.moneda(Math.abs(Number(nota.total) || 0))}. Motivo: ${motivo}`
    });
    return resultado;
  }

  private moneda(n: number): string {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(Number(n) || 0);
  }

  private normalizarStockSucursales(stock: any): { sucursalId: string; cantidad: number }[] {
    if (!stock) return [];
    if (Array.isArray(stock)) return stock.map((s: any) => ({ sucursalId: s.sucursalId, cantidad: Number(s.cantidad) || 0 }));
    return Object.entries(stock).map(([sucursalId, cantidad]) => ({ sucursalId, cantidad: Number(cantidad) || 0 }));
  }

  // =====================================================
  // TICKET (vista previa / impresión)
  // =====================================================

  /**
   * Abre el ticket.
   *  - 'vista': muestra el ticket con un botón "Imprimir" (vista previa).
   *  - 'imprimir': abre y manda directo a la impresora.
   */
  abrir(venta: any, modo: 'vista' | 'imprimir' = 'vista'): void {
    if (modo === 'imprimir') {
      // Directo a la impresora, sin ventana aparte (la ventana aparte congelaba Despacho)
      imprimirEnPagina(this.html(venta, 'imprimir')).catch(err => {
        console.error('No se pudo imprimir el ticket', err);
        alert('No se pudo imprimir el ticket. Probá con "Ver ticket" e imprimí desde ahí.');
      });
      return;
    }
    if (!abrirVistaPrevia(this.html(venta, 'vista'))) {
      alert('El navegador bloqueó la ventana del ticket. Permití las ventanas emergentes para este sitio.');
    }
  }

  // =====================================================
  // PRESUPUESTO (no es una venta: no se guarda ni toca stock)
  // =====================================================

  /** Imprime el presupuesto (sin ventana aparte) */
  abrirPresupuesto(p: DatosPresupuesto): void {
    imprimirEnPagina(this.htmlPresupuesto(p)).catch(err => {
      console.error('No se pudo imprimir el presupuesto', err);
      alert('No se pudo imprimir el presupuesto. Probá de nuevo.');
    });
  }

  /** Bloque "Crédito de la casa" del presupuesto (solo si eligieron un plan; sin el interés) */
  private htmlCreditoPresupuesto(c: DatosPresupuesto['credito'], $: (n: any) => string, esc: (t: any) => string): string {
    if (!c || !c.cuotas?.length) return '';
    const n = c.cuotas.length;
    const primera = c.cuotas[0], ultima = c.cuotas[n - 1];
    const iguales = c.cuotas.every(q => Math.abs(q.importe - primera.importe) < 0.01);
    return `
  <div style="border-top: 2px solid #000; margin-top: 10px; padding-top: 6px;">
    <p style="text-align:center; font-weight:bold; margin: 0 0 4px;">CRÉDITO DE LA CASA</p>
    ${c.canje ? `<div class="fila"><span>Precio del equipo</span><span class="monto">${$(c.precioEquipo)}</span></div>
    <div class="fila"><span>Plan canje${c.canjeDetalle ? ` (${esc(c.canjeDetalle)})` : ''}</span><span class="monto">-${$(c.canje)}</span></div>` : ''}
    ${c.entrega ? `<div class="fila"><span>Entrega</span><span class="monto">${$(c.entrega)}</span></div>` : ''}
    <div class="fila" style="font-weight:bold; font-size: 14px; margin-top: 4px;">
      <span>${n} cuota${n > 1 ? 's' : ''} de</span><span class="monto">${$(primera.importe)}</span>
    </div>
    ${!iguales ? `<div style="font-size: 11px; text-align: right;">(la última de ${$(ultima.importe)})</div>` : ''}
    <p style="font-size: 11px; margin: 4px 0 0;">Las cuotas vencen del 1 al 10 de cada mes, desde ${esc(textoVencimiento(primera).replace(/^1 al 10 de /, ''))}.</p>
  </div>`;
  }

  htmlPresupuesto(p: DatosPresupuesto): string {
    const esc = (t: any) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const $ = (n: any) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(Number(n) || 0);

    const esMayorista = p.tipoPrecio === 'mayorista';
    const wspTexto = esMayorista ? '3426985223' : '3425209886';
    const tituloEmpresa = esMayorista ? 'JC MAYORISTA' : 'JC EXCLUSIVO';
    const logo = `${window.location.origin}/assets/logo2.png`;
    const total = (p.items || []).reduce((a, i) => a + (Number(i.subtotal) || 0), 0);
    // Los equipos no llevan descuento por medio de pago: el % se aplica solo al resto
    const conDescuentoBase = (p.items || []).filter(i => !i.sinDescuento).reduce((a, i) => a + (Number(i.subtotal) || 0), 0);
    const hayEquipos = (p.items || []).some(i => i.sinDescuento);

    // Precio abonando en efectivo / transferencia (solo lista minorista)
    const conDescuento = conDescuentoBase > 0 ? (p.descuentos || [])
      .filter(d => !esMayorista && Number(d.porcentaje) > 0)
      .map(d => `<div class="fila"><span>En ${esc(d.medio)} (-${d.porcentaje}%${hayEquipos ? ', sin equipos' : ''})</span>` +
        `<strong>${$(total - conDescuentoBase * Number(d.porcentaje) / 100)}</strong></div>`)
      .join('') : '';

    return `
<html>
<head>
  <meta charset="utf-8">
  <title>Presupuesto</title>
  <style>
    @page { size: 80mm auto; margin: 0; }
    * { color: #000 !important; }
    body { width: 80mm; margin: 0; padding: 5px; font-family: monospace; font-size: 12px;
           -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    h2, h3 { text-align: center; margin: 5px 0; }
    p { margin: 3px 0; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { padding: 4px; border-bottom: 1px dashed #000; vertical-align: top; }
    .der { text-align: right; white-space: nowrap; }
    .total { font-weight: bold; font-size: 15px; text-align: right; margin-top: 10px; }
    .center { display: flex; justify-content: center; align-items: center; }
    .item { border-bottom: 1px dashed #000; padding: 4px 0; }
    .item .nombre { font-weight: bold; }
    .fila { display: flex; justify-content: space-between; gap: 8px; }
    .fila strong, .fila .monto { white-space: nowrap; }
    .titulo { text-align: center; font-weight: bold; font-size: 18px; letter-spacing: 3px;
              border-top: 2px solid #000; border-bottom: 2px solid #000; padding: 4px 0; margin: 6px 0; }
    .nota { text-align: center; font-size: 11px; margin-top: 10px; }
    .barra { position: sticky; top: 0; background: #f1f1f1; padding: 8px; text-align: center; font-family: Arial; margin: -5px -5px 8px; }
    .barra button { font-size: 14px; padding: 6px 16px; margin: 0 4px; cursor: pointer; }
    @media print { .barra { display: none; } }
  </style>
</head>
<body>
  <div class="barra">
    <button onclick="window.print()">🖨 Imprimir</button>
    <button onclick="window.close()">Cerrar</button>
  </div>

  <div class="center"><img src="${logo}" width="120" onerror="this.style.display='none'"/></div>
  <h2>${tituloEmpresa}</h2>
  <h3>WhatsApp: ${wspTexto}</h3>

  <div class="titulo">PRESUPUESTO</div>

  <p><strong>Fecha:</strong> ${new Date().toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}</p>
  ${p.cliente ? `<p><strong>Cliente:</strong> ${esc(p.cliente)}</p>` : ''}
  ${esMayorista ? '<p><strong>Lista:</strong> mayorista</p>' : ''}

  <div style="border-top: 1px dashed #000;">
    ${(p.items || []).map(item => `
      <div class="item">
        <div class="nombre">${esc(item.nombre)}</div>
        ${item.modelo ? `<div><small>Modelo: ${esc(item.modelo)}</small></div>` : ''}
        ${nombreColor(item.color) ? `<div><small>Color: ${esc(nombreColor(item.color))}</small></div>` : ''}
        ${item.detalle ? `<div><small>${esc(item.detalle)}</small></div>` : ''}
        <div class="fila"><span>${item.cantidad} x ${$(item.precioUnitario)}</span><span class="monto">${$(item.subtotal)}</span></div>
      </div>`).join('')}
  </div>

  <p class="total">TOTAL: ${$(total)}</p>
  ${conDescuento ? `<div style="margin-top: 4px;">${conDescuento}</div>` : ''}
  ${this.htmlCreditoPresupuesto(p.credito, $, esc)}

  <p class="nota">${esc(p.validez || VALIDEZ_PRESUPUESTO)}</p>
  <p class="nota"><strong>NO VÁLIDO COMO FACTURA</strong></p>
  <h3>https://jcexclusivo.com.ar/</h3>

  <script>window.onload = function () { window.print(); };</script>
</body>
</html>`;
  }

  html(venta: any, modo: 'vista' | 'imprimir' = 'vista'): string {
    const esc = (t: any) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const $ = (n: any) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(Number(n) || 0);

    const esMayorista = venta.tipoPrecio === 'mayorista';
    const wspTexto = esMayorista ? '3426985223' : '3425209886';
    const tituloEmpresa = esMayorista ? 'JC MAYORISTA' : 'JC EXCLUSIVO';

    // ↩ Nota de devolución: los importes se guardan negativos; en el papel van en positivo
    const esDevolucion = venta.tipoVenta === 'devolucion';
    const subtotal = esDevolucion ? Math.abs(Number(venta.subtotal) || 0) : Number(venta.subtotal ?? venta.total) || 0;
    const totalFinal = esDevolucion ? Math.abs(Number(venta.total) || 0) : Number(venta.total) || 0;
    const descuentoTotal = esDevolucion ? 0 : subtotal - totalFinal;
    // Ticket con devoluciones: cuánto se devolvió de cada renglón
    const devueltoRenglon = devolucionesVigentes(venta).reduce((m, d) => {
      (d.items || []).forEach(it => m.set(Number(it.indice), (m.get(Number(it.indice)) || 0) + (Number(it.cantidad) || 0)));
      return m;
    }, new Map<number, number>());
    const bloqueDevoluciones = esDevolucion
      ? ''
      : devolucionesVigentes(venta).map(d =>
          `<p style="text-align:right">↩ Devolución ${new Date(d.fecha).toLocaleDateString('es-AR')} (nota ${String(d.nroTicket ?? '').padStart(8, '0')}): -${$(d.importe)}</p>`).join('');

    const lineasDescuento: string[] = [];
    if (venta.descuentoCupon > 0) {
      const detalle = venta.cupon?.tipo === 'porcentaje' ? `${venta.cupon.valor}% OFF` : `$${venta.cupon?.valor} OFF`;
      lineasDescuento.push(`Cupón ${esc(venta.cupon?.codigo || '')} (${detalle}): -${$(venta.descuentoCupon)}`);
    }
    if (venta.descuentoPuntos > 0) {
      lineasDescuento.push(`Canje de ${venta.puntosUsados} puntos: -${$(venta.descuentoPuntos)}`);
    }
    if (venta.descuentoEquipos > 0) {
      lineasDescuento.push(`Descuento equipos (${venta.porcentajeDescuentoEquipos}%): -${$(venta.descuentoEquipos)}`);
    }
    const pagos: any[] = (Array.isArray(venta.pagos) && venta.pagos.length ? venta.pagos : [])
      .map((p: any) => esDevolucion ? { ...p, monto: Math.abs(Number(p.monto) || 0) } : p);
    if (pagos.length) {
      // Descuento de cada medio (si pagó con varios, cada parte lleva el suyo)
      pagos.filter(p => Number(p.descuento) > 0).forEach(p => lineasDescuento.push(
        `Descuento por ${esc(nombreMetodo(p.metodo).toLowerCase())} (${p.porcentajeDescuento}%${pagos.length > 1 ? ' s/ su parte' : ''}${venta.descuentosSoloProductos ? ', sin equipos' : ''}): -${$(p.descuento)}`));
    } else if (venta.descuentoPago > 0) {
      lineasDescuento.push(`Descuento por ${esc(venta.metodoPago)} (${venta.porcentajeDescuentoPago}%): -${$(venta.descuentoPago)}`);
    }
    // Tarjeta: nº de operación del posnet (si lo cargaron)
    const op = (p: any) => p?.detalle ? ` <small>(${esc(p.detalle)})</small>` : '';
    const textoMetodo = pagos.length > 1 ? 'Varios medios (ver detalle abajo)'
      : (pagos.length ? esc(nombreMetodo(pagos[0].metodo)) + op(pagos[0]) : esc(venta.metodoPago));
    const detallePagos = pagos.length > 1
      ? `<table class="pagos"><tbody>${pagos.map(p =>
          `<tr><td>${esc(nombreMetodo(p.metodo))}${op(p)}</td><td class="der">${$(p.monto)}</td></tr>`).join('')}</tbody></table>`
      : '';

    const logo = `${window.location.origin}/assets/logo2.png`;
    const anulada = venta.anulada === true;

    // Cuenta corriente: compra a cuenta (deuda) o cobro de deuda
    const esCobroCuenta = venta.tipoVenta === 'cobrocuenta';
    const esRefinanciacion = venta.tipoVenta === 'refinanciacion';
    const esPago = esCobroCuenta || venta.tipoVenta === 'cobrocuota' || esRefinanciacion;   // comprobante de pago, no de compra
    // 🔁 Refinanciación: el plan nuevo para firmar (el interés no se imprime)
    const rf = esRefinanciacion ? venta.refinanciacion || null : null;
    const bloqueRefinanciacion = !rf ? '' : anulada
      ? '<p><strong>Refinanciación: ANULADA</strong></p>'
      : `<div class="titulo-bloque">REFINANCIACIÓN CRÉDITO DE LA CASA</div>
        <p><small>${esc(rf.equipo || '')}${rf.creditoAnterior?.fecha ? ` · crédito del ${new Date(rf.creditoAnterior.fecha).toLocaleDateString('es-AR')}` : ''}</small></p>
        <table class="pagos"><tbody>
          <tr><td>Saldo adeudado</td><td class="der">${$(rf.saldoAnterior)}</td></tr>
          ${Number(rf.recargo) > 0 ? `<tr><td>Recargo por atraso</td><td class="der">${$(rf.recargo)}</td></tr>` : ''}
          ${Number(rf.entrega) > 0 ? `<tr><td>Entrega</td><td class="der">-${$(rf.entrega)}</td></tr>` : ''}
          <tr><td>A refinanciar</td><td class="der">${$(rf.aRefinanciar)}</td></tr>
          <tr><td><strong>Saldo financiado</strong></td><td class="der"><strong>${$(rf.financiado)}</strong></td></tr>
        </tbody></table>
        <p><strong>Nuevo plan de pagos (${rf.cantidadCuotas} cuota${rf.cantidadCuotas > 1 ? 's' : ''}):</strong></p>
        <table class="pagos"><tbody>${(rf.cuotas || []).map((q: any) =>
          `<tr><td>Cuota ${q.numero}<br><small>vence del ${esc(textoVencimiento(q))}</small></td><td class="der">${$(q.importe)}</td></tr>`).join('')}
        </tbody></table>
        <p style="font-size:11px">Las cuotas se abonan en el local del 1 al 10 de cada mes. Reemplaza el plan de pagos anterior.</p>
        <p style="margin-top:28px;border-top:1px solid #000;text-align:center">Firma y aclaración del cliente</p>`;
    const aCuenta = aCuentaDeVenta(venta);
    const cc = venta.cuentaCorriente || null;
    const bloqueCuenta = anulada ? '' : esCobroCuenta && cc
      ? `${(cc.aplicaciones || []).length ? `<p><strong>Pago imputado a:</strong></p>
          <table class="pagos"><tbody>${(cc.aplicaciones || []).map((a: any) =>
            `<tr><td>Ticket ${a.nroTicket ? String(a.nroTicket).padStart(8, '0') : 'S/N'} (${new Date(a.fecha).toLocaleDateString('es-AR')})` +
            `${Number(a.pendienteNuevo) > 0 ? `<br><small>queda ${$(a.pendienteNuevo)}</small>` : '<br><small>cancelado</small>'}</td>` +
            `<td class="der">${$(a.importe)}</td></tr>`).join('')}</tbody></table>` : ''}
        <p style="text-align:right">Saldo anterior: ${$(cc.saldoAnterior)}</p>
        <p style="text-align:right"><strong>Saldo de su cuenta: ${$(cc.saldoPosterior)}</strong></p>`
      : aCuenta > 0
        ? `<p style="text-align:right"><strong>A cuenta corriente: ${$(aCuenta)}</strong></p>
          ${cc ? `<p style="text-align:right">Saldo anterior: ${$(cc.saldoAnterior)}</p>
          <p style="text-align:right"><strong>Saldo de su cuenta: ${$(cc.saldoPosterior)}</strong></p>` : ''}
          <p style="margin-top:28px;border-top:1px solid #000;text-align:center">Firma y aclaración del cliente</p>`
        : '';

    // 🏠 Crédito de la casa: plan de pagos con los vencimientos y firma del cliente
    const cr = venta.credito || null;
    const bloqueCredito = !cr ? '' : anulada
      ? '<p><strong>Crédito de la casa: ANULADO</strong></p>'
      : `<div class="titulo-bloque">CRÉDITO DE LA CASA</div>
        <table class="pagos"><tbody>
          ${Number(cr.canje)
            ? `<tr><td>Precio del equipo</td><td class="der">${$(cr.precioContado)}</td></tr>
               <tr><td>Plan canje</td><td class="der">-${$(cr.canje)}</td></tr>
               <tr><td>Precio de contado</td><td class="der">${$(Number(cr.precioContado) - Number(cr.canje))}</td></tr>`
            : `<tr><td>Precio de contado</td><td class="der">${$(cr.precioContado)}</td></tr>`}
          ${Number(cr.entrega) ? `<tr><td>Entrega</td><td class="der">-${$(cr.entrega)}</td></tr>` : ''}
          ${cr.interes !== undefined && cr.interes !== null
            ? `<tr><td>A financiar</td><td class="der">${$(cr.aFinanciar)}</td></tr>`   /* el interés no se imprime */
            : (Number(cr.recargo) ? `<tr><td>Precio financiado</td><td class="der">${$(cr.precioFinanciado)}</td></tr>` : '')}
          <tr><td><strong>Saldo financiado</strong></td><td class="der"><strong>${$(cr.saldo)}</strong></td></tr>
        </tbody></table>
        <p><strong>Plan de pagos (${cr.cantidadCuotas} cuota${cr.cantidadCuotas > 1 ? 's' : ''}):</strong></p>
        <table class="pagos"><tbody>${(cr.cuotas || []).map((q: any) =>
          `<tr><td>Cuota ${q.numero}<br><small>vence del ${esc(textoVencimiento(q))}</small></td><td class="der">${$(q.importe)}</td></tr>`).join('')}
        </tbody></table>
        <p style="font-size:11px">Las cuotas se abonan en el local del 1 al 10 de cada mes.</p>
        <p style="margin-top:28px;border-top:1px solid #000;text-align:center">Firma y aclaración del cliente</p>`;
    // 🏠 Cobro de cuotas: a qué cuotas se aplicó y cuánto queda
    const cq = venta.tipoVenta === 'cobrocuota' ? venta.cuotaCredito || null : null;
    const bloqueCuota = !cq || anulada ? '' : `
        <p><strong>Crédito de la casa</strong>${cq.nroTicketCredito ? ` (compra ticket ${String(cq.nroTicketCredito).padStart(8, '0')})` : ''}</p>
        <table class="pagos"><tbody>${(cq.aplicaciones || []).map((a: any) =>
          `<tr><td>Cuota ${a.numero} de ${cq.cantidadCuotas}<br><small>${Number(a.pendienteNuevo) > 0.004 ? `queda ${$(a.pendienteNuevo)}` : 'pagada'}</small></td>` +
          `<td class="der">${$(a.importe)}</td></tr>`).join('')}
          ${Number(cq.recargo) > 0 ? `<tr><td>Recargo fuera de término</td><td class="der">${$(cq.recargo)}</td></tr>` : ''}
        </tbody></table>
        <p style="text-align:right">Saldo anterior: ${$(cq.saldoAnterior)}</p>
        <p style="text-align:right"><strong>${Number(cq.saldoPosterior) > 0.004 ? `Saldo del crédito: ${$(cq.saldoPosterior)}` : 'CRÉDITO CANCELADO'}</strong></p>
        ${(() => {
          const prox = (cq.cuotas || []).find((c: any) => (Number(c.importe) || 0) - (Number(c.pagado) || 0) > 0.004);
          if (!prox) return '';
          const [a, m, d] = String(prox.hasta).split('-');
          return `<p style="text-align:right">Próxima cuota: Nº ${prox.numero}, vence el ${d}/${m}/${a}</p>`;
        })()}`;
    const bloqueCanje = venta.canje && !cr && !anulada
      ? `<p><small>Plan canje: ${esc(venta.canje.detalle)}</small></p>` : '';

    return `
<html>
<head>
  <meta charset="utf-8">
  <title>Ticket ${this.numeroFormateado(venta)}</title>
  <style>
    @page { size: 80mm auto; margin: 0; }
    * { color: #000 !important; }
    body { width: 80mm; margin: 0; padding: 5px; font-family: monospace; font-size: 12px;
           -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    h2, h3 { text-align: center; margin: 5px 0; }
    p { margin: 3px 0; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { padding: 4px; border-bottom: 1px dashed #000; }
    .der { text-align: right; white-space: nowrap; }
    .total { font-weight: bold; font-size: 14px; text-align: right; margin-top: 10px; }
    .tachado { text-decoration: line-through; }
    table.pagos td { border-bottom: none; padding: 1px 4px; }
    .center { display: flex; justify-content: center; align-items: center; }
    .nro { text-align: center; font-weight: bold; font-size: 14px; margin: 4px 0; }
    .anulado { text-align: center; font-weight: bold; font-size: 18px; border: 3px solid #000; padding: 6px; margin: 8px 0; }
    .titulo-bloque { text-align: center; font-weight: bold; border-top: 2px solid #000; border-bottom: 2px solid #000; padding: 3px 0; margin: 8px 0 4px; }
    .barra { position: sticky; top: 0; background: #f1f1f1; padding: 8px; text-align: center; font-family: Arial; margin: -5px -5px 8px; }
    .barra button { font-size: 14px; padding: 6px 16px; margin: 0 4px; cursor: pointer; }
    @media print { .barra { display: none; } }
  </style>
</head>
<body>
  ${modo === 'vista' ? `<div class="barra">
      <button onclick="window.print()">🖨 Imprimir</button>
      <button onclick="window.close()">Cerrar</button>
    </div>` : ''}

  <div class="center"><img src="${logo}" width="120" onerror="this.style.display='none'"/></div>
  <h2>${tituloEmpresa}</h2>
  <h3>WhatsApp: ${wspTexto}</h3>

  <h2>${esDevolucion ? '↩ Nota de devolución' : esRefinanciacion ? '🔁 Refinanciación' : `🧾 ${esPago ? 'Comprobante de pago' : 'Comprobante de compra'}`}</h2>
  <div class="nro">Ticket Nº ${this.numeroFormateado(venta)}</div>

  ${anulada ? `<div class="anulado">ANULADO</div>
    <p><strong>Motivo:</strong> ${esc(venta.motivoAnulacion)}</p>
    <p><strong>Anuló:</strong> ${esc(venta.anuladaPor?.nombre || venta.anuladaPor?.usuario || '')}</p>` : ''}

  <p><strong>Fecha:</strong> ${new Date(venta.fecha).toLocaleString('es-AR')}</p>
  ${esDevolucion ? `<p><strong>Devolución del ticket:</strong> Nº ${String(venta.ventaOriginal?.nroTicket ?? '').padStart(8, '0')}${venta.ventaOriginal?.fecha ? ` (${new Date(venta.ventaOriginal.fecha).toLocaleDateString('es-AR')})` : ''}</p>
    <p><strong>Motivo:</strong> ${esc(venta.motivoDevolucion)}</p>` : ''}
  <p><strong>${esDevolucion ? 'Se devuelve con' : 'Método de pago'}:</strong> ${textoMetodo}</p>
  ${venta.cajero
      ? `<p><strong>Atendió:</strong> ${esc([venta.cajero.nombre, venta.cajero.apellido].filter(Boolean).join(' '))}</p>`
      : (venta.usuario ? `<p><strong>Atendió:</strong> ${esc(venta.usuario.nombre || venta.usuario.usuario)}</p>` : '')}
  ${venta.cliente ? `<p><strong>Cliente:</strong> ${esc(venta.cliente.nombre)}${venta.cliente.dni ? ` (DNI: ${esc(venta.cliente.dni)})` : ''}</p>` : ''}
  ${venta.tipoVenta === 'reparacion' && ordenesDeVenta(venta).length <= 1 ? `<p><strong>Orden de reparación:</strong> #${esc(venta.orden?.numeroOrden)} · ${esc(venta.orden?.equipo)}${venta.orden?.imei ? ` (IMEI ${esc(venta.orden.imei)})` : ''}</p>` : ''}
  ${venta.tipoVenta === 'reparacion' && ordenesDeVenta(venta).length > 1 ? `<p><strong>Órdenes de reparación:</strong> ${esc(textoOrdenes(venta))}</p>` : ''}

  <table>
    <thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Subtotal</th></tr></thead>
    <tbody>
      ${(venta.items || []).map((item: any, indice: number) => `
        <tr>
          <td>${esc(item.nombre)}${devueltoRenglon.get(indice) ? `<br><small><strong>Devuelto: ${devueltoRenglon.get(indice)}</strong></small>` : ''}${item.modelo ? `<br><small>Modelo: ${esc(item.modelo)}</small>` : ''}${nombreColor(item.color) ? `<br><small>Color: ${esc(nombreColor(item.color))}</small>` : ''}${item.tipo === 'equipo' && item.equipo ? `<br><small>IMEI: ${esc(item.equipo.imei)}</small><br><small>${esc([item.equipo.condicion === 'nuevo' ? 'Nuevo' : 'Usado', item.equipo.color, item.equipo.grado ? 'Grado ' + item.equipo.grado : '', 'Batería ' + item.equipo.bateria + '%'].filter(Boolean).join(' · '))}</small>` : ''}</td>
          <td>${esDevolucion ? Math.abs(Number(item.cantidad) || 0) : item.cantidad}</td>
          <td class="der">${$(item.precioUnitario)}</td>
          <td class="der">${$(esDevolucion ? Math.abs(Number(item.subtotal) || 0) : item.subtotal)}</td>
        </tr>`).join('')}
    </tbody>
  </table>

  ${descuentoTotal > 0.004 && !cr ? `
    <p class="tachado">Subtotal: ${$(subtotal)}</p>
    ${lineasDescuento.map(l => `<p>${l}</p>`).join('')}
    <p>Descuento total: ${$(descuentoTotal)}</p>
  ` : ''}

  <p class="total">${esRefinanciacion ? 'ENTREGA' : esDevolucion ? 'TOTAL DEVUELTO' : venta.tipoVenta === 'reparacion' || esPago ? 'TOTAL COBRADO' : cr ? 'TOTAL FINANCIADO' : 'TOTAL FINAL'}: ${$(totalFinal)}</p>
  ${bloqueDevoluciones}
  ${detallePagos ? `<p><strong>Forma de pago:</strong></p>${detallePagos}` : ''}
  ${Number(venta.efectivoRecibido) > 0 && !anulada ? `
    <p style="text-align:right">Efectivo recibido: ${$(venta.efectivoRecibido)}</p>
    <p style="text-align:right"><strong>Su vuelto: ${$(venta.vuelto)}</strong></p>` : ''}
  ${venta.tipoVenta === 'reparacion' && !anulada
    ? (Number(venta.saldoRestante) > 0
        ? (ordenesDeVenta(venta).length > 1
          ? (venta.ordenes || []).filter((o: any) => Number(o.saldoRestante) > 0)
              .map((o: any) => `<p style="text-align:right"><strong>Saldo pendiente orden #${esc(o.numeroOrden)}: ${$(o.saldoRestante)}</strong></p>`).join('')
          : `<p style="text-align:right"><strong>Saldo pendiente: ${$(venta.saldoRestante)}</strong></p>`)
        : `<p style="text-align:right"><strong>${ordenesDeVenta(venta).length > 1 ? 'Reparaciones totalmente pagas' : 'Reparación totalmente paga'}</strong></p>`)
    : ''}
  ${bloqueCuenta}
  ${bloqueCanje}
  ${bloqueCredito}
  ${bloqueRefinanciacion}
  ${bloqueCuota}
  ${venta.puntosGanados > 0 && !anulada ? `<p>Puntos sumados en esta compra: ${venta.puntosGanados}</p>` : ''}

  <h2>${esDevolucion ? 'Devolución registrada' : esPago ? '¡Gracias por su pago! 🙌' : '¡Gracias por su compra! 🙌'}</h2>
  <h3>https://jcexclusivo.com.ar/</h3>

  ${modo === 'imprimir' ? '<script>window.onload = function () { window.print(); };</script>' : ''}
</body>
</html>`;
  }
}
