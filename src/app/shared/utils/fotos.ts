/**
 * Fotos de productos (y de cualquier cosa con "imagen" + "imagenes").
 *  - imagenes: todas las fotos; la primera es la principal.
 *  - imagen:   la principal (se mantiene por compatibilidad: carrito, despacho, pedidos…).
 * Los productos cargados antes de existir "imagenes" solo tienen "imagen".
 */

export const MAX_FOTOS = 6;

export function fotosDe(p: { imagenes?: any; imagen?: any } | null | undefined, max = MAX_FOTOS): string[] {
  const lista = Array.isArray(p?.imagenes) ? p!.imagenes : [];
  const fotos: string[] = lista.filter((u: any) => typeof u === 'string' && u.trim());
  if (!fotos.length && typeof p?.imagen === 'string' && p.imagen.trim()) fotos.push(p.imagen);
  return unicas(fotos).slice(0, max);
}

/** Sin repetidas, respetando el orden */
export function unicas(fotos: (string | null | undefined)[]): string[] {
  const vistas = new Set<string>();
  const res: string[] = [];
  for (const f of fotos) {
    if (typeof f !== 'string' || !f.trim() || vistas.has(f)) continue;
    vistas.add(f);
    res.push(f);
  }
  return res;
}
