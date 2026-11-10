/**
 * Colores de las variantes de producto (se guardan en hexadecimal, ej. '#1e3a8a').
 * Sirve para mostrar el circulito de color y un nombre aproximado
 * (para el tooltip y el ticket, que se imprime en blanco y negro).
 */

/** Devuelve el hex normalizado (#rrggbb) o null si no es un color válido */
export function colorValido(color: any): string | null {
  const s = String(color ?? '').trim();
  const corto = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s);
  if (corto) return `#${corto[1]}${corto[1]}${corto[2]}${corto[2]}${corto[3]}${corto[3]}`.toLowerCase();
  return /^#[0-9a-f]{6}$/i.test(s) ? s.toLowerCase() : null;
}

const NOMBRES: { nombre: string; rgb: [number, number, number] }[] = [
  { nombre: 'Negro', rgb: [20, 20, 20] },
  { nombre: 'Gris oscuro', rgb: [80, 80, 80] },
  { nombre: 'Gris', rgb: [140, 140, 140] },
  { nombre: 'Plateado', rgb: [200, 200, 205] },
  { nombre: 'Blanco', rgb: [250, 250, 250] },
  { nombre: 'Beige', rgb: [222, 200, 160] },
  { nombre: 'Marrón', rgb: [120, 70, 35] },
  { nombre: 'Dorado', rgb: [212, 175, 55] },
  { nombre: 'Amarillo', rgb: [250, 215, 30] },
  { nombre: 'Naranja', rgb: [245, 130, 30] },
  { nombre: 'Rojo', rgb: [210, 30, 35] },
  { nombre: 'Bordó', rgb: [120, 20, 40] },
  { nombre: 'Rosa', rgb: [245, 160, 190] },
  { nombre: 'Rosa claro', rgb: [255, 200, 210] },
  { nombre: 'Fucsia', rgb: [220, 40, 140] },
  { nombre: 'Violeta', rgb: [130, 60, 180] },
  { nombre: 'Lila', rgb: [190, 160, 220] },
  { nombre: 'Azul', rgb: [30, 70, 180] },
  { nombre: 'Azul marino', rgb: [20, 30, 80] },
  { nombre: 'Celeste', rgb: [120, 190, 235] },
  { nombre: 'Turquesa', rgb: [40, 190, 190] },
  { nombre: 'Verde', rgb: [20, 135, 40] },
  { nombre: 'Verde oscuro', rgb: [10, 65, 30] },
  { nombre: 'Verde claro', rgb: [150, 220, 130] }
];

/** Nombre aproximado del color ("Azul", "Rojo"...) o '' si el color no es válido */
export function nombreColor(color: any): string {
  const hex = colorValido(color);
  if (!hex) return '';
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  // Distancia "redmean": aproxima mejor cómo vemos los colores que la distancia RGB simple
  let mejor = NOMBRES[0], menor = Infinity;
  for (const c of NOMBRES) {
    const rm = (r + c.rgb[0]) / 2;
    const dr = r - c.rgb[0], dg = g - c.rgb[1], db = b - c.rgb[2];
    const d = (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
    if (d < menor) { menor = d; mejor = c; }
  }
  return mejor.nombre;
}
