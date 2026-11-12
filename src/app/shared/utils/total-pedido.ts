/**
 * TOTAL DE UN PEDIDO WEB EN PESOS (funciones puras, se prueban sin Angular).
 *
 * Hubo dos errores que guardaban el total "en dólares" (los ítems en USD sin pasar a pesos):
 *  1. Pedidos (admin): al cambiar cantidades, quitar un producto o simplemente volver de ver un
 *     pedido pendiente, el total se recalculaba como Σ precioFinal × cantidad (sin dólar ni descuentos).
 *  2. Checkout: si el cliente confirmaba antes de que cargara la cotización, el dólar valía 1.
 * En los dos casos el total guardado queda MENOR o IGUAL a la suma "cruda" (USD a 1):
 * así se reconocen, y se muestran (y se pueden guardar) recalculados en pesos.
 *
 * Desde el arreglo, el pedido guarda la cotización usada (cotizacionDolar) y el descuento (cupón + puntos).
 */

export interface Cotizacion {
  dolar: number;      // dólar común (productos en USD)
  dolarJC?: number;   // dólar de los equipos (si no está, el común)
}

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const num = (n: any) => Number(n) || 0;
const esEquipo = (i: any) => i?.tipo === 'equipo';

/** Cotización con la que se pasa a pesos un ítem: la guardada en el ítem o el pedido; si no, la de hoy */
export function cotizacionItem(item: any, pedido: any, cot: Cotizacion): number {
  if (item?.moneda !== 'USD') return 1;
  const guardada = num(item?.cotizacionDolar) || num(esEquipo(item) ? pedido?.cotizacionDolarJC : pedido?.cotizacionDolar);
  if (guardada > 0) return guardada;
  return esEquipo(item) ? (num(cot?.dolarJC) || num(cot?.dolar)) : num(cot?.dolar);
}

export function precioItemEnPesos(item: any, pedido: any, cot: Cotizacion): number {
  return num(item?.precioFinal) * cotizacionItem(item, pedido, cot);
}

/** Productos y equipos del carrito en pesos (sin descuentos) */
export function subtotalesEnPesos(carrito: any[], pedido: any, cot: Cotizacion): { productos: number; equipos: number } {
  let productos = 0, equipos = 0;
  for (const i of carrito || []) {
    const monto = precioItemEnPesos(i, pedido, cot) * num(i?.cantidad);
    if (esEquipo(i)) equipos += monto; else productos += monto;
  }
  return { productos: r2(productos), equipos: r2(equipos) };
}

/** Suma "cruda": precioFinal × cantidad, con los USD a 1 (como lo calculaba el error) */
export function subtotalCrudo(carrito: any[]): number {
  return r2((carrito || []).reduce((a, i) => a + num(i?.precioFinal) * num(i?.cantidad), 0));
}

/** ¿El total guardado quedó en dólares? (tiene ítems en USD y el total no pasa la suma cruda) */
export function totalQuedoEnDolares(pedido: any, cot: Cotizacion): boolean {
  const carrito = pedido?.carrito || [];
  if (!carrito.some((i: any) => i?.moneda === 'USD')) return false;
  const s = subtotalesEnPesos(carrito, pedido, cot);
  const pesos = s.productos + s.equipos;
  const crudo = subtotalCrudo(carrito);
  if (!(pesos > crudo * 1.5)) return false;   // sin cotización cargada no se puede saber
  return num(pedido?.total) <= crudo + 0.01;
}

/** Descuento del pedido (cupón + puntos, en pesos): el guardado, o el que se deduce del total */
export function descuentoPedido(pedido: any, cot: Cotizacion): number {
  if (typeof pedido?.descuento === 'number') return Math.max(0, r2(pedido.descuento));
  const carrito = pedido?.carrito || [];
  const total = num(pedido?.total);
  if (totalQuedoEnDolares(pedido, cot)) return Math.max(0, r2(subtotalCrudo(carrito) - total));
  const s = subtotalesEnPesos(carrito, pedido, cot);
  // El descuento es solo sobre los productos (los equipos no tienen)
  return Math.min(s.productos, Math.max(0, r2(s.productos + s.equipos - total)));
}

/** Total del pedido en pesos (si el guardado quedó en dólares, recalculado) */
export function totalPedidoEnPesos(pedido: any, cot: Cotizacion): number {
  if (!totalQuedoEnDolares(pedido, cot)) return r2(num(pedido?.total));
  return totalConCarrito(pedido, pedido?.carrito || [], cot);
}

/** Total en pesos con un carrito nuevo (al editar el pedido): se mantiene el descuento, solo sobre productos */
export function totalConCarrito(pedido: any, carrito: any[], cot: Cotizacion): number {
  const desc = descuentoPedido(pedido, cot);
  const s = subtotalesEnPesos(carrito, pedido, cot);
  return r2(Math.max(0, s.productos - desc) + s.equipos);
}

/** Pedido con el total en pesos (para el dashboard y las listas) */
export function conTotalEnPesos<T extends { total?: any }>(pedido: T, cot: Cotizacion): T {
  return totalQuedoEnDolares(pedido, cot) ? { ...pedido, total: totalPedidoEnPesos(pedido, cot), totalOriginal: (pedido as any).total } : pedido;
}
