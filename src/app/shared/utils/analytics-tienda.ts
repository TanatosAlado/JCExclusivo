/**
 * Google Analytics de la tienda: qué se mide y cómo se describe cada producto
 * (funciones puras, se pueden probar sin Angular).
 *
 * Se mide SOLO la tienda: nada de Gestiones ni Despacho, nada de lo que hagan los
 * administradores logueados, y nada en la compu de desarrollo (localhost).
 */

/** Rutas de uso interno: no se miden */
export const RUTAS_INTERNAS = ['/gestiones', '/despacho'];

export function esRutaInterna(url: string | null | undefined): boolean {
  const ruta = String(url || '').split(/[?#]/)[0].toLowerCase();
  return RUTAS_INTERNAS.some(r => ruta === r || ruta.startsWith(r + '/'));
}

export function esEntornoDePrueba(host: string | null | undefined): boolean {
  const h = String(host || '').toLowerCase();
  return !h || h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' || h.endsWith('.local');
}

/** ¿Se mide esta página? */
export function debeMedir(opciones: { url: string; esAdmin: boolean; host: string }): boolean {
  return !opciones.esAdmin && !esEntornoDePrueba(opciones.host) && !esRutaInterna(opciones.url);
}

/** Ruta "limpia" para Analytics: sin los ids de productos ni de órdenes (agrupa mejor los informes) */
export function rutaParaInforme(url: string | null | undefined): string {
  const ruta = String(url || '/').split(/[?#]/)[0] || '/';
  return ruta
    .replace(/^\/producto\/[^/]+$/i, '/producto')
    .replace(/^\/consulta\/[^/]+$/i, '/consulta');
}

export interface ItemAnalytics {
  item_id: string;
  item_name: string;
  item_category?: string;
  item_category2?: string;
  item_brand?: string;
  item_variant?: string;
  price?: number;
  quantity: number;
}

const texto = (v: any) => (v === null || v === undefined ? '' : String(v).trim());
const redondear = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Producto, variante, equipo o ítem del carrito → ítem de Analytics.
 * precioPesos: precio unitario en pesos (si no se sabe, se omite).
 */
export function itemAnalytics(p: any, precioPesos?: number | null, cantidad = 1): ItemAnalytics {
  const esEquipo = p?.tipo === 'equipo' || !!p?.imei || !!p?.equipoId;
  const eq = p?.equipo || p;
  const nombre = esEquipo
    ? [eq?.modelo, eq?.capacidad].map(texto).filter(Boolean).join(' ') || texto(p?.nombre) || 'Equipo'
    : texto(p?.nombre) || texto(p?.descripcion) || 'Producto';
  const variante = esEquipo
    ? [eq?.condicion === 'nuevo' ? 'Nuevo' : 'Usado', texto(eq?.color)].filter(Boolean).join(' · ')
    : [texto(p?.modelo), texto(p?.color)].filter(Boolean).join(' · ');

  const item: ItemAnalytics = {
    item_id: texto(p?.equipoId || p?.id || p?.codigoBarras) || nombre,
    item_name: nombre.slice(0, 100),
    quantity: Math.max(1, Math.round(Number(cantidad) || 1))
  };
  const categoria = esEquipo ? 'Equipos' : texto(p?.rubro);
  if (categoria) item.item_category = categoria;
  if (!esEquipo && texto(p?.subrubro)) item.item_category2 = texto(p.subrubro);
  if (!esEquipo && texto(p?.marca)) item.item_brand = texto(p.marca);
  if (variante) item.item_variant = variante.slice(0, 100);
  const precio = Number(precioPesos);
  if (isFinite(precio) && precio > 0) item.price = redondear(precio);
  return item;
}

/** Valor total de una lista de ítems (precio × cantidad) */
export function valorItems(items: ItemAnalytics[]): number {
  return redondear((items || []).reduce((acc, i) => acc + (Number(i.price) || 0) * (Number(i.quantity) || 0), 0));
}

/** Texto de búsqueda que vale la pena registrar */
export function terminoBusqueda(textoBuscado: any): string | null {
  const t = texto(textoBuscado).replace(/\s+/g, ' ').toLowerCase();
  return t.length >= 3 ? t.slice(0, 100) : null;
}
