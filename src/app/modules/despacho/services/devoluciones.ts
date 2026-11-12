/**
 * ↩ Devolución parcial de productos de un ticket (funciones puras, se pueden probar sin Angular).
 *
 *  - La devolución se registra como una "nota de devolución": otro ticket (tipoVenta 'devolucion')
 *    con importes NEGATIVOS. Así la caja, el cierre y los reportes la descuentan solos.
 *  - El ticket original no cambia: se le agrega la lista de devoluciones (qué renglones y cuánto).
 *  - Solo productos: los equipos, las reparaciones y los cobros se resuelven anulando el ticket.
 *  - Un ticket con crédito de la casa queda blindado: no se le puede devolver nada.
 */

import { pagosDeVenta, creditoDeVenta, aCuentaDeVenta } from './pagos';

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** Medios con los que el cajero puede devolver la plata */
export const METODOS_DEVOLUCION: ('efectivo' | 'transferencia' | 'tarjeta')[] = ['efectivo', 'transferencia', 'tarjeta'];

/** Lo que se guarda en el ticket original por cada devolución */
export interface DevolucionDeVenta {
  ventaId: string;          // la nota de devolución
  nroTicket: number | null;
  fecha: string;
  items: { indice: number; cantidad: number; importe: number }[];
  importe: number;          // total devuelto (positivo)
  aCuenta: number;          // parte que se descontó de la cuenta corriente
  anulada?: boolean;
}

/** Un renglón que se puede devolver */
export interface RenglonDevolvible {
  indice: number;           // posición en venta.items
  nombre: string;
  modelo?: string | null;
  color?: string | null;
  vendida: number;          // cantidad del ticket
  devuelta: number;         // ya devuelta antes
  disponible: number;       // la que todavía se puede devolver
  precioNeto: number;       // precio por unidad con los descuentos del ticket
}

export interface SeleccionDevolucion {
  indice: number;
  cantidad: number;
}

/** Devoluciones vigentes del ticket */
export function devolucionesVigentes(venta: any): DevolucionDeVenta[] {
  return (Array.isArray(venta?.devoluciones) ? venta.devoluciones : []).filter((d: any) => d && !d.anulada);
}

/** Total devuelto (vigente) del ticket */
export function totalDevuelto(venta: any): number {
  return r2(devolucionesVigentes(venta).reduce((a, d) => a + (Number(d.importe) || 0), 0));
}

/** Parte que ya se descontó de la cuenta corriente en devoluciones anteriores */
export function aCuentaDevuelto(venta: any): number {
  return r2(devolucionesVigentes(venta).reduce((a, d) => a + (Number(d.aCuenta) || 0), 0));
}

/** Cantidad devuelta de cada renglón (por índice) */
export function devueltoPorRenglon(venta: any): Map<number, number> {
  const m = new Map<number, number>();
  for (const d of devolucionesVigentes(venta)) {
    for (const it of d.items || []) {
      m.set(Number(it.indice), (m.get(Number(it.indice)) || 0) + (Number(it.cantidad) || 0));
    }
  }
  return m;
}

/** Renglón de producto (no equipo, no reparación) */
function esProducto(item: any): boolean {
  return !!item && item.tipo !== 'equipo' && item.tipo !== 'reparacion' && !item.equipoId && (Number(item.cantidad) || 0) > 0;
}

/**
 * Cuánto se paga en realidad por cada $1 de lista de los productos (con cupón, descuento por medio de pago, puntos…).
 * Los equipos tienen su propio descuento: se dejan aparte.
 */
export function factorProductos(venta: any): number {
  const items = (venta?.items || []).filter(esProducto);
  const bruto = items.reduce((a: number, i: any) => a + (Number(i.subtotal) || 0), 0);
  if (!(bruto > 0)) return 0;
  const equipos = (venta?.items || []).filter((i: any) => i?.tipo === 'equipo');
  const brutoEquipos = equipos.reduce((a: number, i: any) => a + (Number(i.subtotal) || 0), 0);
  const netoEquipos = Math.max(0, brutoEquipos - (Number(venta?.descuentoEquipos) || 0));
  const neto = Math.max(0, (Number(venta?.total) || 0) - netoEquipos);
  return Math.min(1, neto / bruto);
}

/** Por qué no se le puede devolver nada a este ticket (null = se puede) */
export function motivoSinDevolucion(venta: any): string | null {
  if (!venta) return 'Ticket inválido.';
  if (venta.anulada === true) return 'El ticket está anulado.';
  if (venta.tipoVenta === 'devolucion') return 'Es una nota de devolución.';
  if (venta.tipoVenta === 'reparacion') return 'Es un cobro de reparación: si hace falta, se anula el ticket.';
  if (venta.tipoVenta === 'cobrocuenta' || venta.tipoVenta === 'cobrocuota' || venta.tipoVenta === 'refinanciacion') return 'Es un cobro: si hace falta, se anula el ticket.';
  if (venta.credito || creditoDeVenta(venta) > 0) return 'Tiene crédito de la casa: no se le pueden devolver productos.';
  if (!(venta.items || []).some(esProducto)) return 'No tiene productos para devolver (los equipos se resuelven anulando el ticket).';
  if (!renglonesDevolvibles(venta).length) return 'Ya se devolvieron todos los productos.';
  return null;
}

/** Renglones con unidades que todavía se pueden devolver */
export function renglonesDevolvibles(venta: any): RenglonDevolvible[] {
  const devuelto = devueltoPorRenglon(venta);
  const f = factorProductos(venta);
  const lista: RenglonDevolvible[] = [];
  (venta?.items || []).forEach((item: any, indice: number) => {
    if (!esProducto(item)) return;
    const vendida = Number(item.cantidad) || 0;
    const devuelta = devuelto.get(indice) || 0;
    const disponible = vendida - devuelta;
    if (disponible <= 0) return;
    lista.push({
      indice,
      nombre: String(item.nombre || 'Producto'),
      modelo: item.modelo || null,
      color: item.color || null,
      vendida,
      devuelta,
      disponible,
      precioNeto: r2((Number(item.subtotal) || 0) / vendida * f)
    });
  });
  return lista;
}

/**
 * Importe que se le devuelve por lo elegido (con los descuentos del ticket).
 * Nunca más de lo que pagó y todavía no se le devolvió.
 */
export function importeDevolucion(venta: any, seleccion: SeleccionDevolucion[]): number {
  const renglones = new Map(renglonesDevolvibles(venta).map(r => [r.indice, r]));
  let total = 0;
  for (const s of seleccion || []) {
    const r = renglones.get(Number(s.indice));
    const cant = Math.floor(Number(s.cantidad) || 0);
    if (!r || cant <= 0) continue;
    total += r.precioNeto * Math.min(cant, r.disponible);
  }
  return r2(Math.min(total, Math.max(0, (Number(venta?.total) || 0) - totalDevuelto(venta))));
}

/** Revisa lo elegido. Devuelve los renglones limpios o el error. */
export function validarSeleccion(venta: any, seleccion: SeleccionDevolucion[]): { items: SeleccionDevolucion[] | null; error: string | null } {
  const motivo = motivoSinDevolucion(venta);
  if (motivo) return { items: null, error: motivo };
  const renglones = new Map(renglonesDevolvibles(venta).map(r => [r.indice, r]));
  const items: SeleccionDevolucion[] = [];
  for (const s of seleccion || []) {
    const cant = Number(s.cantidad) || 0;
    if (cant === 0) continue;
    const r = renglones.get(Number(s.indice));
    if (!r) return { items: null, error: 'Ese producto ya no se puede devolver.' };
    if (!Number.isInteger(cant) || cant < 0) return { items: null, error: `La cantidad de "${r.nombre}" tiene que ser un número entero.` };
    if (cant > r.disponible) return { items: null, error: `De "${r.nombre}" se pueden devolver hasta ${r.disponible}.` };
    items.push({ indice: r.indice, cantidad: cant });
  }
  if (!items.length) return { items: null, error: 'Elegí qué productos devuelve.' };
  return { items, error: null };
}

/**
 * Cómo se devuelve: primero se descuenta de la cuenta corriente (si compró a cuenta y todavía debe),
 * y lo que sobra se le devuelve con el medio que elige el cajero.
 * @param pendienteCuenta lo que todavía debe de esa compra en la cuenta corriente
 */
export function repartoDevolucion(venta: any, importe: number, pendienteCuenta: number): { aCuenta: number; dinero: number } {
  const imp = r2(importe);
  const maxCuenta = Math.max(0, r2(aCuentaDeVenta(venta) - aCuentaDevuelto(venta)));
  const aCuenta = r2(Math.max(0, Math.min(imp, maxCuenta, Number(pendienteCuenta) || 0)));
  return { aCuenta, dinero: r2(imp - aCuenta) };
}

/** ¿El ticket tiene algo de cuenta corriente? */
export function tieneCuentaCorriente(venta: any): boolean {
  return pagosDeVenta(venta).some(p => p.metodo === 'cuentacorriente');
}
