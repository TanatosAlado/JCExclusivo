/**
 * 🔧 Cotizador de reparaciones (funciones puras: se prueban sin Angular).
 *
 *  - Plantilla general: rubros (Pantalla, Batería, Pin de carga…), iguales para todos los modelos.
 *  - Cada modelo tiene, por rubro, los REPUESTOS de nuestro stock que le sirven (productos), con una etiqueta opcional (ej. "OLED").
 *  - Precio: el del producto según la lista (minorista / mayorista), en pesos (los de USD se pasan con el dólar).
 *  - Solo se ofrecen los que tienen stock MAYORISTA (el del local donde se repara). En Despacho se ven los sin stock, marcados.
 *  - Es el precio de los repuestos: la mano de obra se suma aparte.
 *  - Una opción por rubro. Con 2 o más repuestos se puede hacer un descuento en $ (en el local, no en la web).
 */

export interface RubroReparacion {
  id: string;
  nombre: string;                   // 'Pantalla'
}

export interface PlantillaReparaciones {
  rubros: RubroReparacion[];
}

/** Un producto del stock que sirve para un rubro del modelo */
export interface RepuestoVinculado {
  productoId: string;
  etiqueta?: string | null;         // lo que ve el cliente (ej. 'OLED'); si no hay, el nombre del producto
}

export interface ModeloReparacion {
  id?: string;
  nombre: string;                   // 'iPhone 13'
  activo: boolean;
  repuestos: { [rubroId: string]: RepuestoVinculado[] };
  orden?: number;
  actualizado?: any;
}

export type TipoPrecioReparacion = 'minorista' | 'mayorista';

/** Una opción para elegir (un repuesto vinculado, con su precio y stock de hoy) */
export interface OpcionRepuesto {
  productoId: string;
  etiqueta: string;                 // lo que se muestra
  producto: string;                 // nombre del producto
  precio: number;                   // $ según la lista
  stock: number;                    // stock mayorista
  conStock: boolean;
}

export interface RubroDelModelo {
  rubro: RubroReparacion;
  opciones: OpcionRepuesto[];
}

export interface ItemCotizacionReparacion {
  rubroId: string;
  rubro: string;
  productoId: string;
  producto: string;
  etiqueta: string;
  precio: number;                   // $
}

export interface CotizacionReparacion {
  modeloId: string | null;
  modelo: string;
  tipoPrecio: TipoPrecioReparacion;
  items: ItemCotizacionReparacion[];
  subtotal: number;                 // $ (solo repuestos)
  descuento: number;                // $
  total: number;                    // $ (solo repuestos: falta la mano de obra)
  dolar: number | null;             // con el que se pasaron los repuestos en USD
}

/** Elección: un producto por rubro (null = tildado pero sin elegir; ausente = ese rubro no se repara) */
export type SeleccionReparacion = { [rubroId: string]: string | null | undefined };

export const MAX_RUBROS_REPARACION = 30;
export const MAX_REPUESTOS_POR_RUBRO = 15;
export const AVISO_MANO_DE_OBRA = 'El precio es solo de los repuestos: falta sumar la mano de obra.';

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const limpiarTexto = (t: any) => String(t ?? '').trim().replace(/\s+/g, ' ');

/** Id corto para un rubro nuevo */
export function idReparacion(prefijo: 'r' = 'r'): string {
  return prefijo + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/** Plantilla con la que arranca (el admin la cambia como quiera) */
export function plantillaInicial(): PlantillaReparaciones {
  return {
    rubros: [
      { id: 'pantalla', nombre: 'Pantalla' },
      { id: 'bateria', nombre: 'Batería' },
      { id: 'pin', nombre: 'Pin de carga' },
      { id: 'camara-trasera', nombre: 'Cámara trasera' },
      { id: 'camara-frontal', nombre: 'Cámara frontal' },
      { id: 'tapa', nombre: 'Tapa trasera' },
      { id: 'parlante', nombre: 'Parlante / auricular' }
    ]
  };
}

/** Limpia y revisa la plantilla. Devuelve la plantilla limpia o el primer error. */
export function validarPlantilla(p: PlantillaReparaciones): { plantilla: PlantillaReparaciones | null; error: string | null } {
  const err = (e: string) => ({ plantilla: null, error: e });
  const rubros: RubroReparacion[] = [];
  const nombres = new Set<string>();
  const ids = new Set<string>();
  for (const [i, r] of (p?.rubros || []).entries()) {
    const nombre = limpiarTexto(r?.nombre);
    if (!nombre) return err(`Escribí el nombre del rubro ${i + 1} (o borralo).`);
    if (nombre.length > 60) return err(`El rubro "${nombre.slice(0, 20)}…" tiene un nombre muy largo.`);
    if (nombres.has(nombre.toLowerCase())) return err(`El rubro "${nombre}" está repetido.`);
    nombres.add(nombre.toLowerCase());
    const id = String(r?.id || '').trim() || idReparacion();
    if (ids.has(id)) return err('Hay rubros con el mismo identificador. Volvé a abrir la plantilla.');
    ids.add(id);
    rubros.push({ id, nombre });
  }
  if (!rubros.length) return err('Cargá al menos un rubro (por ejemplo, Pantalla).');
  if (rubros.length > MAX_RUBROS_REPARACION) return err(`Hasta ${MAX_RUBROS_REPARACION} rubros.`);
  return { plantilla: { rubros }, error: null };
}

/** Modelo vacío para el formulario */
export function modeloReparacionVacio(): ModeloReparacion {
  return { nombre: '', activo: true, repuestos: {} };
}

/** Repuestos vinculados del modelo (los modelos viejos no tienen el campo) */
export function repuestosDe(m: ModeloReparacion | null | undefined, rubroId: string): RepuestoVinculado[] {
  const l = (m?.repuestos as any)?.[rubroId];
  return Array.isArray(l) ? l : [];
}

/** Ids de todos los productos vinculados al modelo (sin repetir) */
export function productosDelModelo(m: ModeloReparacion | null | undefined): string[] {
  return [...new Set<string>(Object.values(m?.repuestos || {}).flatMap((l: any) => (Array.isArray(l) ? l : []).map((x: any) => String(x?.productoId || ''))).filter(Boolean))];
}

/** Revisa un modelo: deja solo rubros de la plantilla, sin productos repetidos y con etiquetas limpias. */
export function validarModeloReparacion(m: ModeloReparacion, plantilla: PlantillaReparaciones): { modelo: ModeloReparacion | null; error: string | null } {
  const err = (e: string) => ({ modelo: null, error: e });
  const nombre = limpiarTexto(m?.nombre);
  if (nombre.length < 2) return err('Ingresá el nombre del modelo.');
  if (nombre.length > 80) return err('El nombre es muy largo.');

  const repuestos: { [rubroId: string]: RepuestoVinculado[] } = {};
  let cantidad = 0;
  for (const r of plantilla?.rubros || []) {
    const vistos = new Set<string>();
    const lista: RepuestoVinculado[] = [];
    for (const x of repuestosDe(m, r.id)) {
      const productoId = String(x?.productoId || '').trim();
      if (!productoId || vistos.has(productoId)) continue;
      vistos.add(productoId);
      const etiqueta = limpiarTexto(x?.etiqueta);
      if (etiqueta.length > 40) return err(`La etiqueta "${etiqueta.slice(0, 20)}…" de ${r.nombre} es muy larga.`);
      lista.push({ productoId, etiqueta: etiqueta || null });
    }
    if (lista.length > MAX_REPUESTOS_POR_RUBRO) return err(`${r.nombre}: hasta ${MAX_REPUESTOS_POR_RUBRO} repuestos.`);
    if (lista.length) { repuestos[r.id] = lista; cantidad += lista.length; }
  }
  if (!cantidad) return err('Vinculá al menos un repuesto del stock.');

  return {
    modelo: { ...(m.id ? { id: m.id } : {}), nombre, activo: m.activo !== false, repuestos, orden: Number(m.orden) || 0 },
    error: null
  };
}

/** Nombre para mostrar de un producto del stock */
export function nombreProducto(p: any): string {
  if (!p) return 'Producto';
  const base = limpiarTexto(p.nombre) || limpiarTexto(p.descripcion) || 'Producto';
  const extra = [p.modelo, p.color].map(limpiarTexto).filter(x => x && !base.toLowerCase().includes(x.toLowerCase()));
  return [base, ...extra].join(' · ');
}

/** Stock mayorista del producto */
export function stockRepuesto(p: any): number {
  return Math.max(0, Math.floor(Number(p?.stockMayorista) || 0));
}

/** Precio en $ del producto según la lista (los de USD se pasan con el dólar) */
export function precioRepuesto(p: any, tipo: TipoPrecioReparacion, dolar: number | null): number {
  const base = Number(tipo === 'mayorista' ? p?.precioMayorista : p?.precioMinorista) || 0;
  if (!(base > 0)) return 0;
  if (p?.moneda === 'USD') {
    const d = Number(dolar) || 0;
    return d > 0 ? Math.round(base * d) : 0;
  }
  return r2(base);
}

/**
 * Rubros que se ofrecen en el modelo con sus opciones (en el orden de la plantilla y de lo vinculado).
 * @param productos los productos del stock por id (los que no están o no tienen precio no se ofrecen)
 * @param incluirSinStock en Despacho se muestran (marcados); en la web no
 */
export function rubrosDelModelo(
  plantilla: PlantillaReparaciones | null,
  modelo: ModeloReparacion | null,
  productos: { [id: string]: any },
  tipo: TipoPrecioReparacion = 'minorista',
  dolar: number | null = null,
  incluirSinStock = false
): RubroDelModelo[] {
  if (!plantilla || !modelo) return [];
  return plantilla.rubros
    .map(rubro => ({
      rubro,
      opciones: repuestosDe(modelo, rubro.id)
        .map((v): OpcionRepuesto | null => {
          const p = productos?.[v.productoId];
          if (!p) return null;
          const precio = precioRepuesto(p, tipo, dolar);
          if (!(precio > 0)) return null;
          const stock = stockRepuesto(p);
          const producto = nombreProducto(p);
          return { productoId: v.productoId, etiqueta: limpiarTexto(v.etiqueta) || producto, producto, precio, stock, conStock: stock > 0 };
        })
        .filter((o): o is OpcionRepuesto => !!o && (incluirSinStock || o.conStock))
    }))
    .filter(x => x.opciones.length > 0);
}

/**
 * Calcula la cotización (solo repuestos).
 * @param seleccion un producto por rubro
 * @param descuento $ (solo con 2 o más repuestos; tiene que ser menor al subtotal)
 */
export function calcularCotizacionReparacion(
  plantilla: PlantillaReparaciones | null,
  modelo: ModeloReparacion | null,
  productos: { [id: string]: any },
  seleccion: SeleccionReparacion,
  opciones: { tipo?: TipoPrecioReparacion; dolar?: number | null; descuento?: number | null } = {}
): { resultado: CotizacionReparacion | null; error: string | null } {
  if (!modelo) return { resultado: null, error: null };
  const tipo: TipoPrecioReparacion = opciones.tipo === 'mayorista' ? 'mayorista' : 'minorista';
  const ofrecidos = rubrosDelModelo(plantilla, modelo, productos, tipo, opciones.dolar ?? null, true);
  const items: ItemCotizacionReparacion[] = [];
  for (const r of ofrecidos) {
    const elegido = seleccion?.[r.rubro.id];
    if (!elegido) continue;
    const o = r.opciones.find(x => x.productoId === elegido);
    if (!o) return { resultado: null, error: `Ese repuesto de ${r.rubro.nombre} ya no está disponible.` };
    if (!o.conStock) return { resultado: null, error: `${o.etiqueta} (${r.rubro.nombre}) no tiene stock.` };
    items.push({ rubroId: r.rubro.id, rubro: r.rubro.nombre, productoId: o.productoId, producto: o.producto, etiqueta: o.etiqueta, precio: o.precio });
  }
  if (!items.length) return { resultado: null, error: null };

  const subtotal = r2(items.reduce((a, x) => a + x.precio, 0));
  const d = r2(Number(opciones.descuento) || 0);
  if (d < 0) return { resultado: null, error: 'El descuento no puede ser negativo.' };
  if (d > 0 && items.length < 2) return { resultado: null, error: 'El descuento se puede hacer con 2 repuestos o más.' };
  if (d > 0 && d >= subtotal) return { resultado: null, error: 'El descuento no puede ser igual o mayor al total.' };
  const dolar = Number(opciones.dolar) > 0 ? Number(opciones.dolar) : null;
  return {
    resultado: { modeloId: modelo.id || null, modelo: modelo.nombre, tipoPrecio: tipo, items, subtotal, descuento: d, total: r2(subtotal - d), dolar },
    error: null
  };
}

/** "Pantalla (OLED) + Batería (Original)" */
export function textoReparaciones(r: { items?: ItemCotizacionReparacion[] } | null): string {
  return (r?.items || []).map(i => `${i.rubro} (${i.etiqueta})`).join(' + ');
}

/** "$ 125.000" (pesos enteros) */
export function textoPesos(n: number): string {
  return '$ ' + Math.round(Number(n) || 0).toLocaleString('es-AR');
}
