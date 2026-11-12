/**
 * 🎨 Paleta de colores DE PRUEBA (para que el dueño elija el color del sitio).
 *
 *  - Solo la ven los administradores, en la tienda (no en Gestiones ni en Despacho).
 *  - Los colores elegidos se guardan en ESE navegador: los clientes siguen viendo el sitio como siempre.
 *  - Para sacarla cuando terminen de elegir: poner PALETA_COLORES_ACTIVA en false (o borrar el componente).
 *    El color elegido se pasa a --color-primario en src/styles.css.
 */

export const PALETA_COLORES_ACTIVA = true;

export const COLOR_PRIMARIO_ORIGINAL = '#204977';
export const COLOR_FONDO_ORIGINAL = '#ffffff';

const CLAVE = 'paletaColoresPrueba';

export interface PaletaColores {
  primario: string;   // barra, pie, botones, paginador (--color-primario)
  fondo: string;      // fondo de la página
}

/** Colores sugeridos para el color principal */
export const SUGERIDOS_PRIMARIO: { nombre: string; color: string }[] = [
  { nombre: 'Azul actual', color: '#204977' },
  { nombre: 'Negro', color: '#111111' },
  { nombre: 'Grafito', color: '#2b2f36' },
  { nombre: 'Azul noche', color: '#0f2340' },
  { nombre: 'Azul Apple', color: '#0071e3' },
  { nombre: 'Petróleo', color: '#0e4d5c' },
  { nombre: 'Verde oscuro', color: '#1f4d3a' },
  { nombre: 'Bordó', color: '#6d1f2f' },
  { nombre: 'Violeta', color: '#4b2a7b' },
  { nombre: 'Titanio', color: '#5b5750' },
  { nombre: 'Dorado', color: '#9a7b3c' },
  { nombre: 'Rosa', color: '#c2185b' }
];

/** Colores sugeridos para el fondo de la página (claros, para que se lea bien) */
export const SUGERIDOS_FONDO: { nombre: string; color: string }[] = [
  { nombre: 'Blanco (actual)', color: '#ffffff' },
  { nombre: 'Gris muy claro', color: '#f5f5f7' },
  { nombre: 'Gris claro', color: '#eceef1' },
  { nombre: 'Hueso', color: '#faf7f2' },
  { nombre: 'Celeste', color: '#eef4fb' },
  { nombre: 'Verde agua', color: '#eef7f3' },
  { nombre: 'Lavanda', color: '#f3f0fa' },
  { nombre: 'Arena', color: '#f4efe6' }
];

/** '#abc' / '#AABBCC' → '#aabbcc' (o null si no es un color) */
export function normalizarHex(c: any): string | null {
  const s = String(c || '').trim().toLowerCase();
  const m3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(s);
  if (m3) return `#${m3[1]}${m3[1]}${m3[2]}${m3[2]}${m3[3]}${m3[3]}`;
  return /^#[0-9a-f]{6}$/.test(s) ? s : null;
}

/** ¿El texto blanco se lee bien sobre este color? (contraste WCAG ≥ 3 para textos de la barra) */
export function blancoSeLee(hex: string): boolean {
  const h = normalizarHex(hex);
  if (!h) return true;
  const canal = (i: number) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const L = 0.2126 * canal(1) + 0.7152 * canal(3) + 0.0722 * canal(5);
  return 1.05 / (L + 0.05) >= 3;
}

export function leerPaleta(): PaletaColores | null {
  try {
    const p = JSON.parse(localStorage.getItem(CLAVE) || 'null');
    const primario = normalizarHex(p?.primario);
    const fondo = normalizarHex(p?.fondo);
    return primario || fondo ? { primario: primario || COLOR_PRIMARIO_ORIGINAL, fondo: fondo || COLOR_FONDO_ORIGINAL } : null;
  } catch {
    return null;
  }
}

export function guardarPaleta(p: PaletaColores | null) {
  try {
    if (p) localStorage.setItem(CLAVE, JSON.stringify(p));
    else localStorage.removeItem(CLAVE);
  } catch { /* navegador sin almacenamiento: se aplica igual mientras está abierta la página */ }
}

/** Aplica los colores al sitio (o vuelve a los originales con null) */
export function aplicarPaleta(p: PaletaColores | null) {
  if (typeof document === 'undefined') return;
  const raiz = document.documentElement;
  if (p && normalizarHex(p.primario) && p.primario !== COLOR_PRIMARIO_ORIGINAL) raiz.style.setProperty('--color-primario', p.primario);
  else raiz.style.removeProperty('--color-primario');
  if (p && normalizarHex(p.fondo) && p.fondo !== COLOR_FONDO_ORIGINAL) {
    raiz.style.setProperty('--color-fondo-prueba', p.fondo);
    document.body.classList.add('fondo-prueba');
  } else {
    raiz.style.removeProperty('--color-fondo-prueba');
    document.body.classList.remove('fondo-prueba');
  }
}

/** Al abrir el sitio: si este navegador tenía colores de prueba, se aplican (solo mientras la paleta esté activa) */
export function aplicarPaletaGuardada() {
  if (!PALETA_COLORES_ACTIVA) { aplicarPaleta(null); return; }
  aplicarPaleta(leerPaleta());
}
