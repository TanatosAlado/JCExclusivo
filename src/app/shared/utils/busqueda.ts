import { nombreColor } from './colores';

/**
 * Búsqueda flexible de productos.
 *
 *  - Sin distinguir mayúsculas ni tildes ("modulo" encuentra "Módulo").
 *  - Palabras en cualquier orden y salteadas: "tapa 13" o "iphone 13"
 *    encuentran "Tapa trasera iPhone 13".
 *  - Busca en descripción, código de barras, marca, modelo, rubro, subrubro y color.
 *  - Los números tienen que coincidir enteros: "13" encuentra "iPhone 13" o "13 Pro",
 *    pero no "130" ni "2013". Lo mismo con modelos como "a12" (no trae "a125").
 *  - Plural/singular: "tapas" encuentra "tapa"; "fundas" encuentra "funda".
 *  - Las palabras pegadas a números también se separan: "iphone13" = "iphone 13".
 *
 * Ordena por relevancia: código de barras exacto, después lo que coincide en la descripción
 * (primero lo que empieza con la primera palabra), y por último por nombre.
 */

export function normalizarTexto(texto: any): string {
  return String(texto ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    // separa letras de números: "iphone13" → "iphone 13", "13pro" → "13 pro" (pero deja "a12")
    .replace(/([a-z]{2,})(\d)/g, '$1 $2')
    .replace(/(\d)([a-z]{2,})/g, '$1 $2')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Palabras de la búsqueda (sin repetidas) */
export function palabrasDeBusqueda(texto: string): string[] {
  return [...new Set(normalizarTexto(texto).split(' ').filter(Boolean))];
}

const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * ¿La palabra buscada aparece en el texto (ya normalizado)?
 * @param escribiendo es la última palabra (todavía la están tipeando): un número
 *                    alcanza con que empiece así ("tapa 1" ya muestra 12 y 13)
 */
function coincide(texto: string, palabra: string, escribiendo = false): boolean {
  const tieneNumero = /\d/.test(palabra);
  if (tieneNumero) {
    // Números y modelos ("13", "a12", "s23"): tienen que coincidir enteros
    return new RegExp(`(^| )${escapar(palabra)}${escribiendo ? '' : '( |$)'}`).test(texto);
  }
  if (texto.includes(palabra)) return true;
  // Plural → singular: "tapas" → "tapa", "cargadores" → "cargador"
  if (palabra.length > 4 && palabra.endsWith('es') && texto.includes(palabra.slice(0, -2))) return true;
  if (palabra.length > 3 && palabra.endsWith('s') && texto.includes(palabra.slice(0, -1))) return true;
  return false;
}

/** Texto donde se busca (se calcula una vez por producto) */
function textoDe(p: any): { todo: string; descripcion: string; codigo: string } {
  const descripcion = normalizarTexto(p?.descripcion || p?.nombre);
  const color = nombreColor(p?.color);
  const todo = [
    descripcion,
    normalizarTexto(p?.subdescripcion),
    normalizarTexto(p?.marca),
    normalizarTexto(p?.modelo),
    normalizarTexto(p?.rubro),
    normalizarTexto(p?.subrubro),
    normalizarTexto(color),
    normalizarTexto(p?.codigoBarras)
  ].filter(Boolean).join(' ');
  return { todo, descripcion, codigo: String(p?.codigoBarras ?? '').trim().toLowerCase() };
}

export function buscarProductosFlexible<T>(productos: T[], busqueda: string, max = 50): T[] {
  const palabras = palabrasDeBusqueda(busqueda);
  if (!palabras.length) return [];
  const exacto = String(busqueda ?? '').trim().toLowerCase();

  const resultados: { p: T; puntaje: number; nombre: string }[] = [];
  for (const p of productos) {
    const t = textoDe(p);
    const esCodigo = !!t.codigo && t.codigo === exacto;
    const ultima = palabras.length - 1;
    if (!esCodigo && !palabras.every((w, i) => coincide(t.todo, w, i === ultima))) continue;

    let puntaje = 0;
    if (esCodigo) puntaje -= 1000;
    // Todas las palabras están en la descripción (no solo en marca/rubro)
    if (palabras.every(w => coincide(t.descripcion, w))) puntaje -= 100;
    else if (palabras.every((w, i) => coincide(t.descripcion, w, i === ultima))) puntaje -= 90;
    // La descripción empieza con la primera palabra
    if (t.descripcion.startsWith(palabras[0])) puntaje -= 10;
    // Las palabras aparecen en el mismo orden y seguidas
    if (t.descripcion.includes(palabras.join(' '))) puntaje -= 5;
    resultados.push({ p, puntaje, nombre: t.descripcion });
  }

  return resultados
    .sort((a, b) => a.puntaje - b.puntaje || a.nombre.length - b.nombre.length || a.nombre.localeCompare(b.nombre))
    .slice(0, max)
    .map(r => r.p);
}
