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

/** 🔋 Salud (vida útil) de la batería: siempre estas 3 opciones */
export type OpcionBateria = 'mas90' | 'entre85y90' | 'menos85';

export const OPCIONES_BATERIA: { valor: OpcionBateria; texto: string }[] = [
  { valor: 'mas90', texto: 'Más del 90%' },
  { valor: 'entre85y90', texto: 'Entre 85% y 90%' },
  { valor: 'menos85', texto: 'Menos del 85%' }
];

/** Descuento en USD por la batería (por modelo). Con más del 90% no se descuenta. */
export interface BateriaTasador {
  entre85y90: number;
  menos85: number;
}

export interface ModeloTasador {
  id?: string;
  nombre: string;                 // 'iPhone 17 Pro Max'
  activo: boolean;
  capacidades: CapacidadTasador[];
  bateria?: BateriaTasador;       // los modelos viejos no lo tienen: se toma 0
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
  bateria: { opcion: OpcionBateria; texto: string; descuento: number } | null;
  descuentos: number;                         // USD (total, batería incluida)
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

/** Texto de una opción de batería */
export function textoBateria(o: OpcionBateria | null | undefined): string {
  return OPCIONES_BATERIA.find(x => x.valor === o)?.texto || '';
}

/** Descuentos de batería del modelo (0 si no los tiene cargados) */
export function bateriaDe(m: ModeloTasador | null | undefined): BateriaTasador {
  return {
    entre85y90: Math.max(0, Number(m?.bateria?.entre85y90) || 0),
    menos85: Math.max(0, Number(m?.bateria?.menos85) || 0)
  };
}

/** USD que descuenta la opción de batería elegida */
export function descuentoBateria(m: ModeloTasador | null | undefined, o: OpcionBateria | null | undefined): number {
  const b = bateriaDe(m);
  return o === 'entre85y90' ? b.entre85y90 : o === 'menos85' ? b.menos85 : 0;
}

/** Modelo vacío para el formulario */
export function modeloVacio(): ModeloTasador {
  return { nombre: '', activo: true, capacidades: [{ capacidad: '', precio: null as any }], bateria: { entre85y90: null as any, menos85: null as any }, preguntas: [] };
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

  // 🔋 Batería: montos en USD (vacío = 0)
  const montoBateria = (v: any) => (v === null || v === undefined || String(v) === '') ? 0 : Number(v);
  const b85 = montoBateria(m.bateria?.entre85y90);
  const bMenos = montoBateria(m.bateria?.menos85);
  if (!(b85 >= 0) || !(bMenos >= 0)) return err('Los descuentos de la batería tienen que ser 0 o más.');
  const bateria: BateriaTasador = { entre85y90: r2(b85), menos85: r2(bMenos) };

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
    modelo: { ...(m.id ? { id: m.id } : {}), nombre, activo: m.activo !== false, capacidades, bateria, preguntas, orden: Number(m.orden) || 0 },
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
 * @param bateria opción elegida de salud de batería (es obligatoria: si falta, cuenta como pregunta sin responder)
 * @returns el resultado, cuántas preguntas faltan responder (batería incluida) y si ya está completa
 */
export function calcularTasacion(
  modelo: ModeloTasador | null,
  capacidad: string | null,
  respuestas: { [preguntaId: string]: RespuestaSiNo | undefined },
  cotizacion: number | null = null,
  bateria: OpcionBateria | null = null
): { resultado: ResultadoTasacion | null; faltan: number; completa: boolean } {
  if (!modelo) return { resultado: null, faltan: 0, completa: false };
  const cap = (modelo.capacidades || []).find(c => c.capacidad === capacidad) || null;
  const preguntas = modelo.preguntas || [];
  const bat = OPCIONES_BATERIA.some(o => o.valor === bateria) ? bateria : null;
  const faltan = preguntas.filter(p => respuestas?.[p.id] !== 'si' && respuestas?.[p.id] !== 'no').length + (bat ? 0 : 1);
  if (!cap) return { resultado: null, faltan, completa: false };

  const resp = preguntas
    .filter(p => respuestas?.[p.id] === 'si' || respuestas?.[p.id] === 'no')
    .map(p => {
      const r = respuestas[p.id] as RespuestaSiNo;
      return { pregunta: p.texto, respuesta: r, descuento: r === p.descuentaSi ? r2(p.descuento) : 0 };
    });
  const bateriaRes: ResultadoTasacion['bateria'] = bat
    ? { opcion: bat, texto: textoBateria(bat), descuento: r2(descuentoBateria(modelo, bat)) }
    : null;
  const descuentos = r2(resp.reduce((a, x) => a + x.descuento, 0) + (bateriaRes?.descuento || 0));
  const totalUSD = Math.max(0, r2(cap.precio - descuentos));
  const cot = Number(cotizacion) > 0 ? Number(cotizacion) : null;
  return {
    resultado: {
      modeloId: modelo.id || null,
      modelo: modelo.nombre,
      capacidad: cap.capacidad,
      precioBase: cap.precio,
      respuestas: resp,
      bateria: bateriaRes,
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
