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
import { nombreMetodo } from './pagos';

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

  constructor(private firestore: Firestore, private auditoria: AuditoriaService) { }

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
      stockDevuelto: [], stockNoDevuelto: [], puntosRevertidos: false, cuponDevuelto: false, cajaCerrada: false, ordenReparacion: null
    });
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
    const win = window.open('', '_blank', 'width=420,height=760');
    if (!win) {
      alert('El navegador bloqueó la ventana del ticket. Permití las ventanas emergentes para este sitio.');
      return;
    }
    win.document.write(this.html(venta, modo));
    win.document.close();
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
    const pagos: any[] = Array.isArray(venta.pagos) && venta.pagos.length ? venta.pagos : [];
    if (pagos.length) {
      // Descuento de cada medio (si pagó con varios, cada parte lleva el suyo)
      pagos.filter(p => Number(p.descuento) > 0).forEach(p => lineasDescuento.push(
        `Descuento por ${esc(nombreMetodo(p.metodo).toLowerCase())} (${p.porcentajeDescuento}%${pagos.length > 1 ? ' s/ su parte' : ''}): -${$(p.descuento)}`));
    } else if (venta.descuentoPago > 0) {
      lineasDescuento.push(`Descuento por ${esc(venta.metodoPago)} (${venta.porcentajeDescuentoPago}%): -${$(venta.descuentoPago)}`);
    }
    const textoMetodo = pagos.length > 1 ? 'Varios medios (ver detalle abajo)' : esc(pagos.length ? nombreMetodo(pagos[0].metodo) : venta.metodoPago);
    const detallePagos = pagos.length > 1
      ? `<table class="pagos"><tbody>${pagos.map(p =>
          `<tr><td>${esc(nombreMetodo(p.metodo))}</td><td class="der">${$(p.monto)}</td></tr>`).join('')}</tbody></table>`
      : '';

    const logo = `${window.location.origin}/assets/logo2.png`;
    const anulada = venta.anulada === true;

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

  <h2>🧾 Comprobante de compra</h2>
  <div class="nro">Ticket Nº ${this.numeroFormateado(venta)}</div>

  ${anulada ? `<div class="anulado">ANULADO</div>
    <p><strong>Motivo:</strong> ${esc(venta.motivoAnulacion)}</p>
    <p><strong>Anuló:</strong> ${esc(venta.anuladaPor?.nombre || venta.anuladaPor?.usuario || '')}</p>` : ''}

  <p><strong>Fecha:</strong> ${new Date(venta.fecha).toLocaleString('es-AR')}</p>
  <p><strong>Método de pago:</strong> ${textoMetodo}</p>
  ${venta.usuario ? `<p><strong>Atendió:</strong> ${esc(venta.usuario.nombre || venta.usuario.usuario)}</p>` : ''}
  ${venta.cliente ? `<p><strong>Cliente:</strong> ${esc(venta.cliente.nombre)}${venta.cliente.dni ? ` (DNI: ${esc(venta.cliente.dni)})` : ''}</p>` : ''}
  ${venta.tipoVenta === 'reparacion' ? `<p><strong>Orden de reparación:</strong> #${esc(venta.orden?.numeroOrden)} · ${esc(venta.orden?.equipo)}${venta.orden?.imei ? ` (IMEI ${esc(venta.orden.imei)})` : ''}</p>` : ''}

  <table>
    <thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Subtotal</th></tr></thead>
    <tbody>
      ${(venta.items || []).map((item: any) => `
        <tr>
          <td>${esc(item.nombre)}</td>
          <td>${item.cantidad}</td>
          <td class="der">${$(item.precioUnitario)}</td>
          <td class="der">${$(item.subtotal)}</td>
        </tr>`).join('')}
    </tbody>
  </table>

  ${descuentoTotal > 0.004 ? `
    <p class="tachado">Subtotal: ${$(subtotal)}</p>
    ${lineasDescuento.map(l => `<p>${l}</p>`).join('')}
    <p>Descuento total: ${$(descuentoTotal)}</p>
  ` : ''}

  <p class="total">${venta.tipoVenta === 'reparacion' ? 'TOTAL COBRADO' : 'TOTAL FINAL'}: ${$(totalFinal)}</p>
  ${detallePagos ? `<p><strong>Forma de pago:</strong></p>${detallePagos}` : ''}
  ${venta.tipoVenta === 'reparacion' && !anulada
    ? (Number(venta.saldoRestante) > 0
        ? `<p style="text-align:right"><strong>Saldo pendiente: ${$(venta.saldoRestante)}</strong></p>`
        : `<p style="text-align:right"><strong>Reparación totalmente paga</strong></p>`)
    : ''}
  ${venta.puntosGanados > 0 && !anulada ? `<p>Puntos sumados en esta compra: ${venta.puntosGanados}</p>` : ''}

  <h2>¡Gracias por su compra! 🙌</h2>
  <h3>https://jcexclusivo.com.ar/</h3>

  ${modo === 'imprimir' ? '<script>window.onload = function () { window.print(); };</script>' : ''}
</body>
</html>`;
  }
}
