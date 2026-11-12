/**
 * Historial de compras del cliente ("Mi cuenta"), funciones puras (se pueden probar sin Angular).
 *
 * Junta:
 *  - Pedidos web: los que se leen de las colecciones (traen el estado) y los guardados en
 *    el historial del cliente (los pedidos viejos que no tienen clienteId se ven igual, sin estado).
 *  - Tickets del local (Despacho) donde se lo eligió como cliente: compras, cobros de
 *    reparaciones y pagos de cuenta corriente.
 */

import { textoPagos } from 'src/app/modules/despacho/services/pagos';

export type TipoCompra = 'web' | 'local' | 'reparacion' | 'cuenta';
export type EstadoCompra = 'pendiente' | 'finalizado' | 'cancelado' | 'anulado' | 'pagado' | null;

export interface CompraHistorial {
  clave: string;               // única (para el *ngFor)
  tipo: TipoCompra;
  titulo: string;              // "Pedido web #123", "Compra en el local · ticket 00000045"...
  fecha: Date | null;
  total: number;
  estado: EstadoCompra;
  items: { nombre: string; cantidad: number }[];
  detalles: string[];          // entrega, forma de pago, etc.
}

/** Colecciones de pedidos web → estado que ve el cliente */
export const COLECCIONES_PEDIDOS: { coleccion: string; estado: EstadoCompra }[] = [
  { coleccion: 'Pedidos Pendientes', estado: 'pendiente' },
  { coleccion: 'Pedidos Finalizados', estado: 'finalizado' },
  { coleccion: 'Pedidos Eliminados', estado: 'cancelado' }
];

export const TEXTO_ESTADO: Record<string, string> = {
  pendiente: 'En preparación',
  finalizado: 'Entregado',
  cancelado: 'Cancelado',
  anulado: 'Anulado',
  pagado: 'Pagado'
};

/** Fecha de un pedido ("dd/MM/yyyy HH:mm", Timestamp o ISO) o de un ticket (ISO) */
export function fechaDe(fecha: any): Date | null {
  if (!fecha) return null;
  if (typeof fecha?.toDate === 'function') return fecha.toDate();
  const m = String(fecha).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4] || 0), Number(m[5] || 0));
  const d = new Date(fecha);
  return isNaN(d.getTime()) ? null : d;
}

const num = (v: any) => Number(v) || 0;

function itemsDeCarrito(carrito: any[]): { nombre: string; cantidad: number }[] {
  return (carrito || []).map(i => ({
    nombre: String(i?.nombre || i?.descripcion || 'Producto') +
      (i?.modelo ? ` · ${i.modelo}` : ''),
    cantidad: num(i?.cantidad) || 1
  }));
}

function textoEntrega(entrega: any): string {
  if (!entrega) return '';
  if (typeof entrega === 'string') return entrega;
  return entrega.tipo || entrega.descripcion || entrega.nombre || '';
}

function textoPago(pago: any): string {
  if (!pago || pago === 'S/P') return '';
  if (typeof pago === 'string') return pago;
  return pago.tipo || pago.descripcion || pago.nombre || '';
}

/** Número de ticket como en Despacho: 00000045 */
function nroTicket(v: any): string {
  const n = num(v?.nroTicket);
  return n ? String(n).padStart(8, '0') : '';
}

export function compraDePedido(p: any, estado: EstadoCompra): CompraHistorial {
  const entrega = textoEntrega(p?.entrega);
  const pago = textoPago(p?.pago);
  return {
    clave: 'web-' + (p?.id || p?.nroPedido),
    tipo: 'web',
    titulo: `Pedido web${p?.nroPedido ? ' #' + p.nroPedido : ''}`,
    fecha: fechaDe(p?.fecha),
    total: num(p?.total),
    estado,
    items: itemsDeCarrito(p?.carrito),
    detalles: [entrega && `Entrega: ${entrega}`, pago && `Pago: ${pago}`].filter(Boolean) as string[]
  };
}

export function compraDeVenta(v: any, moneda: (n: number) => string): CompraHistorial {
  const tipo: TipoCompra = v?.tipoVenta === 'reparacion' ? 'reparacion'
    : v?.tipoVenta === 'cobrocuenta' || v?.tipoVenta === 'cobrocuota' || v?.tipoVenta === 'refinanciacion' ? 'cuenta' : 'local';
  const ticket = nroTicket(v);
  const base = v?.tipoVenta === 'devolucion'
    ? `Devolución de productos${v?.ventaOriginal?.nroTicket ? ' · ticket ' + String(v.ventaOriginal.nroTicket).padStart(8, '0') : ''}`
    : tipo === 'reparacion'
    ? (Array.isArray(v?.ordenes) && v.ordenes.length > 1
      ? `Reparación · órdenes ${v.ordenes.map((o: any) => '#' + (o?.numeroOrden ?? '?')).join(', ')}`
      : `Reparación${v?.orden?.numeroOrden ? ' · orden #' + v.orden.numeroOrden : ''}`)
    : tipo === 'cuenta' ? (v?.tipoVenta === 'refinanciacion' ? 'Refinanciación del crédito de la casa' : v?.tipoVenta === 'cobrocuota' ? 'Pago de cuota (crédito de la casa)' : 'Pago de cuenta corriente') : 'Compra en el local';

  const items = tipo === 'cuenta' ? [] : (v?.items || []).map((i: any) => ({
    nombre: String(i?.nombre || 'Producto'),
    cantidad: num(i?.cantidad) || 1
  }));

  const pagos = textoPagos(v, moneda);
  const detalles = [
    pagos && `Pago: ${pagos}`,
    tipo === 'reparacion' && num(v?.saldoRestante) > 0 && v?.anulada !== true ? `Saldo pendiente: ${moneda(num(v.saldoRestante))}` : '',
    v?.anulada === true && v?.motivoAnulacion ? `Motivo de anulación: ${v.motivoAnulacion}` : ''
  ].filter(Boolean) as string[];

  return {
    clave: 'ticket-' + (v?.id || ticket),
    tipo,
    titulo: base + (ticket ? ` · ticket ${ticket}` : ''),
    fecha: fechaDe(v?.fecha),
    total: num(v?.total),
    estado: v?.anulada === true ? 'anulado' : (tipo === 'local' ? 'pagado' : null),
    items,
    detalles
  };
}

/**
 * Arma el historial completo, del más nuevo al más viejo.
 *  pedidos:   [{ coleccion, data }] leídos de las colecciones de pedidos
 *  historial: cliente.historial (pedidos guardados en la cuenta al comprar)
 *  ventas:    tickets del local con cliente.id del cliente
 */
export function armarHistorial(
  pedidos: { coleccion: string; data: any }[],
  historial: any[],
  ventas: any[],
  moneda: (n: number) => string
): CompraHistorial[] {
  const lista: CompraHistorial[] = [];
  const vistos = new Set<string>();

  // Pedidos web con estado (si un pedido apareciera en dos colecciones, gana la más "avanzada")
  const orden = ['Pedidos Finalizados', 'Pedidos Eliminados', 'Pedidos Pendientes'];
  const ordenados = [...(pedidos || [])].sort((a, b) => orden.indexOf(a.coleccion) - orden.indexOf(b.coleccion));
  for (const { coleccion, data } of ordenados) {
    const id = data?.id;
    if (!id || vistos.has(id)) continue;
    vistos.add(id);
    const estado = COLECCIONES_PEDIDOS.find(c => c.coleccion === coleccion)?.estado ?? null;
    lista.push(compraDePedido(data, estado));
  }

  // Pedidos guardados en la cuenta que no se encontraron (viejos, sin clienteId): sin estado
  for (const h of historial || []) {
    const id = h?.id;
    if (id && vistos.has(id)) continue;
    if (id) vistos.add(id);
    lista.push(compraDePedido(h, null));
  }

  for (const v of ventas || []) lista.push(compraDeVenta(v, moneda));

  return lista.sort((a, b) => (b.fecha?.getTime() || 0) - (a.fecha?.getTime() || 0));
}
