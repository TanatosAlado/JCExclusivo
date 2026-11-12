/**
 * 🧮 Tasador de equipos usados (funciones puras: se pueden probar sin Angular).
 *
 *  - Cada modelo tiene un precio en USD por capacidad (el valor en las mejores condiciones).
 *  - Y su propia lista de preguntas Sí/No: si la respuesta es la que "descuenta", se resta un monto fijo en USD.
 *  - El valor tasado nunca baja de 0.
 */

export type RespuestaSiNo = 'si' | 'no';

export interface CapacidadTasador {
  capacidad: string;      // '256 GB'
  precio: number;         // USD en las mejores condiciones
}

export interface PreguntaTasador {
  id: string;
  texto: string;                  // '¿Pantalla sana?'
  descuentaSi: RespuestaSiNo;     // con qué respuesta se descuenta ('no' para "¿Pantalla sana?")
  descuento: number;              // USD
}

export interface ModeloTasador {
  id?: string;
  nombre: string;                 // 'iPhone 17 Pro Max'
  activo: boolean;
  capacidades: CapacidadTasador[];
  preguntas: PreguntaTasador[];
  orden?: number;
  actualizado?: any;
}

export interface DescuentoAplicado {
  pregunta: string;
  respuesta: RespuestaSiNo;
  descuento: number;
}

export interface ResultadoTasacion {
  modeloId: string | null;
  modelo: string;
  capacidad: string;
  precioBase: number;                         // USD
  respuestas: { pregunta: string; respuesta: RespuestaSiNo; descuento: number }[];
  descuentos: number;                         // USD (total)
  totalUSD: number;
  cotizacion: number | null;                  // $ por USD (si se pasó a pesos)
  totalARS: number | null;
}

export const MAX_PREGUNTAS_TASADOR = 60;
export const MAX_CAPACIDADES_TASADOR = 10;

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** Id corto para una pregunta nueva */
export function idPregunta(): string {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/** Modelo vacío para el formulario */
export function modeloVacio(): ModeloTasador {
  return { nombre: '', activo: true, capacidades: [{ capacidad: '', precio: null as any }], preguntas: [] };
}

/** Limpia y revisa un modelo antes de guardarlo. Devuelve el modelo limpio o el primer error. */
export function validarModelo(m: ModeloTasador): { modelo: ModeloTasador | null; error: string | null } {
  const err = (e: string) => ({ modelo: null, error: e });
  const nombre = String(m?.nombre || '').trim().replace(/\s+/g, ' ');
  if (nombre.length < 2) return err('Ingresá el nombre del modelo.');
  if (nombre.length > 80) return err('El nombre es muy largo.');

  const capacidades: CapacidadTasador[] = [];
  for (const c of m.capacidades || []) {
    const cap = String(c?.capacidad || '').trim();
    const vacia = !cap && (c?.precio === null || c?.precio === undefined || String(c.precio) === '');
    if (vacia) continue;
    if (!cap) return err('Elegí la capacidad de cada precio.');
    const precio = Number(c.precio);
    if (!(precio > 0)) return err(`Ingresá el precio en USD de ${cap}.`);
    if (capacidades.some(x => x.capacidad === cap)) return err(`La capacidad ${cap} está repetida.`);
    capacidades.push({ capacidad: cap, precio: r2(precio) });
  }
  if (!capacidades.length) return err('Cargá al menos una capacidad con su precio.');
  if (capacidades.length > MAX_CAPACIDADES_TASADOR) return err(`Hasta ${MAX_CAPACIDADES_TASADOR} capacidades por modelo.`);

  const preguntas: PreguntaTasador[] = [];
  for (const [i, p] of (m.preguntas || []).entries()) {
    const texto = String(p?.texto || '').trim().replace(/\s+/g, ' ');
    if (!texto) return err(`Escribí la pregunta ${i + 1} (o borrala).`);
    if (texto.length > 200) return err(`La pregunta ${i + 1} es muy larga.`);
    const descuento = Number(p.descuento);
    if (!(descuento >= 0) || p.descuento === null || p.descuento === undefined || String(p.descuento) === '') {
      return err(`Ingresá cuánto descuenta la pregunta "${texto}" (puede ser 0).`);
    }
    preguntas.push({
      id: String(p.id || idPregunta()),
      texto,
      descuentaSi: p.descuentaSi === 'si' ? 'si' : 'no',
      descuento: r2(descuento)
    });
  }
  if (preguntas.length > MAX_PREGUNTAS_TASADOR) return err(`Hasta ${MAX_PREGUNTAS_TASADOR} preguntas por modelo.`);

  return {
    modelo: { ...(m.id ? { id: m.id } : {}), nombre, activo: m.activo !== false, capacidades, preguntas, orden: Number(m.orden) || 0 },
    error: null
  };
}

/** USD → pesos (redondeado al peso) */
export function usdAPesos(usd: number, cotizacion: number): number {
  const c = Number(cotizacion) || 0;
  if (!(c > 0)) return 0;
  return Math.round((Number(usd) || 0) * c);
}

/**
 * Calcula la tasación con las respuestas dadas.
 * @param respuestas por id de pregunta
 * @returns el resultado, cuántas preguntas faltan responder y si ya está completa
 */
export function calcularTasacion(
  modelo: ModeloTasador | null,
  capacidad: string | null,
  respuestas: { [preguntaId: string]: RespuestaSiNo | undefined },
  cotizacion: number | null = null
): { resultado: ResultadoTasacion | null; faltan: number; completa: boolean } {
  if (!modelo) return { resultado: null, faltan: 0, completa: false };
  const cap = (modelo.capacidades || []).find(c => c.capacidad === capacidad) || null;
  const preguntas = modelo.preguntas || [];
  const faltan = preguntas.filter(p => respuestas?.[p.id] !== 'si' && respuestas?.[p.id] !== 'no').length;
  if (!cap) return { resultado: null, faltan, completa: false };

  const resp = preguntas
    .filter(p => respuestas?.[p.id] === 'si' || respuestas?.[p.id] === 'no')
    .map(p => {
      const r = respuestas[p.id] as RespuestaSiNo;
      return { pregunta: p.texto, respuesta: r, descuento: r === p.descuentaSi ? r2(p.descuento) : 0 };
    });
  const descuentos = r2(resp.reduce((a, x) => a + x.descuento, 0));
  const totalUSD = Math.max(0, r2(cap.precio - descuentos));
  const cot = Number(cotizacion) > 0 ? Number(cotizacion) : null;
  return {
    resultado: {
      modeloId: modelo.id || null,
      modelo: modelo.nombre,
      capacidad: cap.capacidad,
      precioBase: cap.precio,
      respuestas: resp,
      descuentos,
      totalUSD,
      cotizacion: cot,
      totalARS: cot ? usdAPesos(totalUSD, cot) : null
    },
    faltan,
    completa: faltan === 0
  };
}

/** "USD 800" */
export function textoUSD(n: number): string {
  const v = Number(n) || 0;
  return 'USD ' + (Number.isInteger(v) ? v.toLocaleString('es-AR') : v.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
}
