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
  ordenReparacion: number | null;  // si era un cobro de reparación: nº de orden a la que se le descontó el cobro
  /** Si tocaba la cuenta corriente: 'cargo' = se descontó la deuda; 'pago' = la deuda volvió a quedar pendiente */
  cuentaCorriente: { tipo: 'cargo' | 'pago'; cliente: string; importe: number } | null;
  /** Equipos que volvieron a estar a la venta */
  equiposDevueltos: string[];
  /** 🏠 Si era una venta con crédito de la casa: el crédito quedó anulado */
  creditoAnulado?: boolean;
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
    const refsOrden = esReparacion
      ? ['Ordenes Pendientes', 'Ordenes Finalizadas'].map(col => doc(this.firestore, col, venta.orden.id))
      : [];

    const vacio = (): ResultadoAnulacion => ({
      stockDevuelto: [], stockNoDevuelto: [], puntosRevertidos: false, cuponDevuelto: false, cajaCerrada: false, ordenReparacion: null,
      cuentaCorriente: null,
      equiposDevueltos: [],
      creditoAnulado: false,
      cuotasRevertidas: null
    });
    // 🏠 Crédito de la casa: se anula junto con el ticket, solo si no tiene cuotas pagadas
    const creditoRef = venta.credito?.creditoId ? doc(this.firestore, 'Creditos', venta.credito.creditoId) : null;
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

      // 🏠 Crédito de la casa
      const creditoSnap = creditoRef ? await tx.get(creditoRef) : null;
      const credito: any = creditoSnap?.exists() ? creditoSnap.data() : null;
      if (credito && credito.estado !== 'anulado' && (Number(credito.pagado) || 0) > 0.004) {
        throw new TicketError(`No se puede anular: el crédito de la casa ya tiene ${'$'}${(Number(credito.pagado) || 0).toFixed(2)} pagados. ` +
          'Primero hay que anular los pagos de las cuotas.');
      }

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

      // Cobro de reparación: se descuenta de la orden (el saldo vuelve a quedar pendiente)
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
        resultado.ordenReparacion = orden.numeroOrden ?? venta.orden.numeroOrden ?? null;
      }

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

      if (creditoRef && credito && credito.estado !== 'anulado') {
        tx.update(creditoRef, {
          estado: 'anulado',
          anulado: { fecha: new Date().toISOString(), usuario, motivo: motivo.trim(), por: 'ticket' }
        });
        resultado.creditoAnulado = true;
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

    const subtotal = Number(venta.subtotal ?? venta.total) || 0;
    const totalFinal = Number(venta.total) || 0;
    const descuentoTotal = subtotal - totalFinal;

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
    const pagos: any[] = Array.isArray(venta.pagos) && venta.pagos.length ? venta.pagos : [];
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
    const esPago = esCobroCuenta || venta.tipoVenta === 'cobrocuota';   // comprobante de pago, no de compra
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
          <tr><td>Precio de contado</td><td class="der">${$(cr.precioContado)}</td></tr>
          ${Number(cr.recargo) ? `<tr><td>Precio financiado</td><td class="der">${$(cr.precioFinanciado)}</td></tr>` : ''}
          ${Number(cr.canje) ? `<tr><td>Plan canje</td><td class="der">-${$(cr.canje)}</td></tr>` : ''}
          ${Number(cr.entrega) ? `<tr><td>Entrega</td><td class="der">-${$(cr.entrega)}</td></tr>` : ''}
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

  <h2>🧾 ${esPago ? 'Comprobante de pago' : 'Comprobante de compra'}</h2>
  <div class="nro">Ticket Nº ${this.numeroFormateado(venta)}</div>

  ${anulada ? `<div class="anulado">ANULADO</div>
    <p><strong>Motivo:</strong> ${esc(venta.motivoAnulacion)}</p>
    <p><strong>Anuló:</strong> ${esc(venta.anuladaPor?.nombre || venta.anuladaPor?.usuario || '')}</p>` : ''}

  <p><strong>Fecha:</strong> ${new Date(venta.fecha).toLocaleString('es-AR')}</p>
  <p><strong>Método de pago:</strong> ${textoMetodo}</p>
  ${venta.cajero
      ? `<p><strong>Atendió:</strong> ${esc([venta.cajero.nombre, venta.cajero.apellido].filter(Boolean).join(' '))}</p>`
      : (venta.usuario ? `<p><strong>Atendió:</strong> ${esc(venta.usuario.nombre || venta.usuario.usuario)}</p>` : '')}
  ${venta.cliente ? `<p><strong>Cliente:</strong> ${esc(venta.cliente.nombre)}${venta.cliente.dni ? ` (DNI: ${esc(venta.cliente.dni)})` : ''}</p>` : ''}
  ${venta.tipoVenta === 'reparacion' ? `<p><strong>Orden de reparación:</strong> #${esc(venta.orden?.numeroOrden)} · ${esc(venta.orden?.equipo)}${venta.orden?.imei ? ` (IMEI ${esc(venta.orden.imei)})` : ''}</p>` : ''}

  <table>
    <thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Subtotal</th></tr></thead>
    <tbody>
      ${(venta.items || []).map((item: any) => `
        <tr>
          <td>${esc(item.nombre)}${item.modelo ? `<br><small>Modelo: ${esc(item.modelo)}</small>` : ''}${nombreColor(item.color) ? `<br><small>Color: ${esc(nombreColor(item.color))}</small>` : ''}${item.tipo === 'equipo' && item.equipo ? `<br><small>IMEI: ${esc(item.equipo.imei)}</small><br><small>${esc([item.equipo.condicion === 'nuevo' ? 'Nuevo' : 'Usado', item.equipo.color, item.equipo.grado ? 'Grado ' + item.equipo.grado : '', 'Batería ' + item.equipo.bateria + '%'].filter(Boolean).join(' · '))}</small>` : ''}</td>
          <td>${item.cantidad}</td>
          <td class="der">${$(item.precioUnitario)}</td>
          <td class="der">${$(item.subtotal)}</td>
        </tr>`).join('')}
    </tbody>
  </table>

  ${descuentoTotal > 0.004 && !cr ? `
    <p class="tachado">Subtotal: ${$(subtotal)}</p>
    ${lineasDescuento.map(l => `<p>${l}</p>`).join('')}
    <p>Descuento total: ${$(descuentoTotal)}</p>
  ` : ''}

  <p class="total">${venta.tipoVenta === 'reparacion' || esPago ? 'TOTAL COBRADO' : cr ? 'TOTAL FINANCIADO' : 'TOTAL FINAL'}: ${$(totalFinal)}</p>
  ${detallePagos ? `<p><strong>Forma de pago:</strong></p>${detallePagos}` : ''}
  ${Number(venta.efectivoRecibido) > 0 && !anulada ? `
    <p style="text-align:right">Efectivo recibido: ${$(venta.efectivoRecibido)}</p>
    <p style="text-align:right"><strong>Su vuelto: ${$(venta.vuelto)}</strong></p>` : ''}
  ${venta.tipoVenta === 'reparacion' && !anulada
    ? (Number(venta.saldoRestante) > 0
        ? `<p style="text-align:right"><strong>Saldo pendiente: ${$(venta.saldoRestante)}</strong></p>`
        : `<p style="text-align:right"><strong>Reparación totalmente paga</strong></p>`)
    : ''}
  ${bloqueCuenta}
  ${bloqueCanje}
  ${bloqueCredito}
  ${bloqueCuota}
  ${venta.puntosGanados > 0 && !anulada ? `<p>Puntos sumados en esta compra: ${venta.puntosGanados}</p>` : ''}

  <h2>${esPago ? '¡Gracias por su pago! 🙌' : '¡Gracias por su compra! 🙌'}</h2>
  <h3>https://jcexclusivo.com.ar/</h3>

  ${modo === 'imprimir' ? '<script>window.onload = function () { window.print(); };</script>' : ''}
</body>
</html>`;
  }
}
