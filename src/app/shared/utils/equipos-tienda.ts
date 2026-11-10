/**
 * Equipos en la tienda online y en el carrito web (funciones puras, se pueden probar sin Angular).
 *
 * Un equipo en el carrito es un ítem más, con:
 *   tipo: 'equipo', equipoId, cantidad 1 (siempre), stock 1, precioFinal en su moneda (USD o ARS)
 * No lleva cupón ni puntos (ni suma puntos).
 */

export const PREFIJO_UID_EQUIPO = 'equipo-';

/**
 * Cotización para los equipos: el "dólar JC" de Gestiones → Empresa
 * (si no está cargado, el dólar común).
 */
export function cotizacionEquipos(info: { dolar?: number; dolarJC?: number } | null | undefined): number {
  const jc = Number(info?.dolarJC);
  return jc > 0 ? jc : (Number(info?.dolar) || 0);
}

export function esItemEquipo(item: any): boolean {
  return item?.tipo === 'equipo' && !!item?.equipoId;
}

/** Precio de lista del equipo (en su moneda) según el tipo de cliente */
export function precioListaEquipo(e: { precioMinorista: number; precioMayorista: number }, esMayorista: boolean): number {
  return Number(esMayorista ? e.precioMayorista : e.precioMinorista) || 0;
}

/** Precio en pesos (USD × dólar) */
export function precioEquipoEnPesos(
  e: { precioMinorista: number; precioMayorista: number; moneda?: string }, esMayorista: boolean, dolar: number
): number {
  const precio = precioListaEquipo(e, esMayorista);
  return e.moneda === 'USD' ? precio * (Number(dolar) || 0) : precio;
}

/** Ítem de carrito para un equipo */
export function itemCarritoDeEquipo(e: any, esMayorista: boolean): any {
  return {
    uidCarrito: PREFIJO_UID_EQUIPO + e.id,
    id: e.id,
    tipo: 'equipo',
    equipoId: e.id,
    imagen: e.imagen || '',
    nombre: [e.modelo, e.capacidad].filter(Boolean).join(' '),
    cantidad: 1,
    oferta: false,
    precioOferta: null,
    precioFinal: precioListaEquipo(e, esMayorista),
    moneda: e.moneda === 'ARS' ? 'ARS' : 'USD',
    stock: 1,
    color: null,          // el color del equipo va en "equipo" (no es un hex de variante)
    modelo: null,
    equipo: {
      condicion: e.condicion === 'nuevo' ? 'nuevo' : 'usado',
      modelo: e.modelo || '',
      color: e.color || '',
      capacidad: e.capacidad || '',
      grado: e.grado || '',
      bateria: Number(e.bateria) || 0,
      imei: e.imei || '',
      observaciones: e.observaciones || ''
    }
  };
}

/** Nuevo / usado (los equipos cargados antes de existir el dato eran usados) */
export function esNuevo(eq: any): boolean {
  return eq?.condicion === 'nuevo';
}

/** Texto corto del equipo: "Usado · NATURAL · Grado A · Batería 91%" */
export function detalleEquipo(eq: any): string {
  if (!eq) return '';
  return [esNuevo(eq) ? 'Nuevo' : 'Usado', eq.color, eq.grado ? `Grado ${eq.grado}` : '',
    eq.bateria || eq.bateria === 0 ? `Batería ${eq.bateria}%` : '']
    .filter(Boolean).join(' · ');
}

/**
 * Subtotal del carrito separado: productos (llevan cupón y puntos) y equipos (no).
 * precioEnPesos(item) devuelve el precio unitario en pesos.
 */
export function subtotalesCarrito(carrito: any[], precioEnPesos: (item: any) => number): { productos: number; equipos: number } {
  let productos = 0, equipos = 0;
  for (const item of carrito || []) {
    const monto = precioEnPesos(item) * (Number(item.cantidad) || 0);
    if (esItemEquipo(item)) equipos += monto;
    else productos += monto;
  }
  return { productos, equipos };
}

/**
 * Total del carrito web: cupón y puntos solo sobre los productos; los equipos van a precio de lista.
 * Devuelve también la parte de productos (para calcular los puntos que suma).
 */
export function totalCarritoWeb(
  carrito: any[],
  precioEnPesos: (item: any) => number,
  opciones: { cupon?: any; usarPuntos?: boolean; puntosCliente?: number; valorPunto?: number } = {}
): { total: number; productos: number; equipos: number; puntosUsados: number } {
  const { productos: subProductos, equipos } = subtotalesCarrito(carrito, precioEnPesos);
  let productos = subProductos;

  const cupon = opciones.cupon;
  if (cupon && cupon.activo) {
    if (cupon.tipo === 'porcentaje') productos -= (Number(cupon.valor) / 100) * productos;
    else if (cupon.tipo === 'monto') productos -= Number(cupon.valor) || 0;
    productos = Math.max(productos, 0);
  }

  let puntosUsados = 0;
  const valorPunto = Number(opciones.valorPunto) || 50;
  if (opciones.usarPuntos && (Number(opciones.puntosCliente) || 0) > 0) {
    puntosUsados = Math.min(Number(opciones.puntosCliente) || 0, Math.floor(productos / valorPunto));
    productos = Math.max(productos - puntosUsados * valorPunto, 0);
  }

  return { total: productos + equipos, productos, equipos, puntosUsados };
}
