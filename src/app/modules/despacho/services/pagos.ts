/**
 * Pagos con uno o varios medios (efectivo / tarjeta / transferencia) en una misma venta.
 *
 * REGLA DEL DESCUENTO (proporcional):
 *   cada parte lleva el descuento de SU medio. Ej: total $100.000, efectivo 10%:
 *   paga $40.000 con tarjeta (cubre $40.000) y el resto, $60.000, en efectivo con 10% → $54.000.
 *
 * El vendedor carga el monto de todos los medios menos el último; el último ("resto") se calcula solo.
 * Funciones puras (sin Angular) para poder probarlas.
 */

export type MetodoPago = 'efectivo' | 'tarjeta' | 'transferencia' | 'cuentacorriente' | 'creditocasa' | 'canje';
export type MetodoNormalizado = MetodoPago | 'otros';

/** Medios con los que entra dinero a la caja */
export const METODOS_PAGO: { valor: MetodoPago; nombre: string; icono: string }[] = [
  { valor: 'efectivo', nombre: 'Efectivo', icono: '💵' },
  { valor: 'tarjeta', nombre: 'Tarjeta', icono: '💳' },
  { valor: 'transferencia', nombre: 'Transferencia', icono: '🏦' }
];

/**
 * "Cuenta corriente": el cliente se lleva la mercadería y lo debe (solo clientes mayoristas).
 * NO es dinero: no entra a la caja el día de la venta, entra cuando se cobra la deuda.
 */
export const METODO_CUENTA_CORRIENTE: { valor: MetodoPago; nombre: string; icono: string } =
  { valor: 'cuentacorriente', nombre: 'Cuenta corriente', icono: '📒' };

/**
 * "Crédito de la casa": lo que el cliente financia en cuotas (ver credito-casa.ts).
 * NO es dinero: entra a la caja a medida que paga las cuotas.
 */
export const METODO_CREDITO_CASA: { valor: MetodoPago; nombre: string; icono: string } =
  { valor: 'creditocasa', nombre: 'Crédito de la casa', icono: '🏠' };

/** "Plan canje": el cliente entrega un equipo usado como parte de pago. NO es dinero. */
export const METODO_CANJE: { valor: MetodoPago; nombre: string; icono: string } =
  { valor: 'canje', nombre: 'Plan canje', icono: '📲' };

/** Medios que NO son dinero (no entran a la caja) */
export const METODOS_SIN_DINERO: MetodoNormalizado[] = ['cuentacorriente', 'creditocasa', 'canje'];

/** Un pago guardado en la venta */
export interface PagoVenta {
  metodo: MetodoPago;
  monto: number;                 // lo que efectivamente pagó con ese medio
  porcentajeDescuento: number;   // % de descuento de ese medio (0 si no corresponde)
  descuento: number;             // $ de descuento que generó esa parte
  detalle?: string;              // tarjeta: nº de operación del posnet u otra observación (opcional)
}

/** Una línea que carga el vendedor (monto null = sin cargar) */
export interface LineaPago {
  metodo: MetodoPago | null;
  monto: number | null;
}

export interface ResultadoPagos {
  pagos: PagoVenta[];
  descuentoTotal: number;
  totalFinal: number;
  /** Monto calculado para la última línea (el resto) */
  resto: number;
  error: string | null;
}

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export function nombreMetodo(m: any): string {
  const n = normalizarMetodo(m);
  if (n === 'otros') return m ? String(m) : 'Sin especificar';
  return [...METODOS_PAGO, METODO_CUENTA_CORRIENTE, METODO_CREDITO_CASA, METODO_CANJE].find(x => x.valor === n)!.nombre;
}

export function normalizarMetodo(m: any): MetodoNormalizado {
  const s = String(m || '').toLowerCase();
  // Exactos: "tarjeta de crédito" es tarjeta, no crédito de la casa
  if (s === 'creditocasa' || s.includes('de la casa')) return 'creditocasa';
  if (s === 'canje' || s.includes('plan canje')) return 'canje';
  if (s.includes('cuenta')) return 'cuentacorriente';
  if (s.includes('efectivo')) return 'efectivo';
  if (s.includes('tarjeta')) return 'tarjeta';
  if (s.includes('transferencia') || s.includes('qr')) return 'transferencia';
  return 'otros';
}

/**
 * Calcula cuánto paga cada medio.
 * @param totalBase total después de cupón y puntos (antes del descuento por medio de pago)
 * @param lineas    medios elegidos; el monto de la ÚLTIMA se ignora (es el resto)
 * @param porcentaje % de descuento de cada medio (0 si no aplican descuentos, ej. mayorista)
 */
export function calcularPagos(
  totalBase: number,
  lineas: LineaPago[],
  porcentaje: (m: MetodoPago) => number
): ResultadoPagos {
  const vacio = (error: string | null): ResultadoPagos =>
    ({ pagos: [], descuentoTotal: 0, totalFinal: r2(totalBase), resto: 0, error });

  const base = r2(totalBase);
  if (!lineas.length || lineas.some(l => !l.metodo)) {
    return vacio('Elegí el método de pago.');
  }
  const metodos = lineas.map(l => l.metodo as MetodoPago);
  if (new Set(metodos).size !== metodos.length) {
    return vacio('Hay un medio de pago repetido.');
  }

  const pct = (m: MetodoPago) => Math.min(100, Math.max(0, Number(porcentaje(m)) || 0));
  const pagos: PagoVenta[] = [];
  let baseCubierta = 0;

  // Todas menos la última: monto cargado por el vendedor
  for (const l of lineas.slice(0, -1)) {
    const monto = r2(l.monto as number);
    if (!(monto > 0)) return vacio('Completá el monto de cada medio de pago (salvo el último, que se calcula solo).');
    const p = pct(l.metodo as MetodoPago);
    // Monto pagado con descuento p% → cubre monto / (1 - p%) del total
    const cubre = p >= 100 ? monto : monto / (1 - p / 100);
    baseCubierta += cubre;
    pagos.push({ metodo: l.metodo as MetodoPago, monto, porcentajeDescuento: p, descuento: r2(cubre - monto) });
  }

  const baseResto = base - baseCubierta;
  if (baseResto < -0.009) {
    return vacio('Los montos cargados superan el total a pagar.');
  }

  const ultimo = lineas[lineas.length - 1].metodo as MetodoPago;
  const pUlt = pct(ultimo);
  const resto = r2(Math.max(0, baseResto) * (1 - pUlt / 100));
  if (lineas.length > 1 && resto <= 0) {
    return { ...vacio('Con los montos cargados ya se cubre el total: quitá el último medio.'), resto: 0 };
  }
  pagos.push({
    metodo: ultimo,
    monto: resto,
    porcentajeDescuento: pUlt,
    descuento: r2(Math.max(0, baseResto) - resto)
  });

  const totalFinal = r2(pagos.reduce((a, p) => a + p.monto, 0));
  return {
    pagos,
    descuentoTotal: r2(base - totalFinal),
    totalFinal,
    resto,
    error: null
  };
}

/**
 * Pagos de una venta guardada. Las ventas viejas (antes de los pagos divididos)
 * solo tienen metodoPago + total: se toman como un único pago.
 */
export function pagosDeVenta(venta: any): { metodo: MetodoNormalizado; monto: number; detalle?: string }[] {
  if (Array.isArray(venta?.pagos) && venta.pagos.length) {
    return venta.pagos.map((p: any) => ({
      metodo: normalizarMetodo(p.metodo),
      monto: Number(p.monto) || 0,
      ...(p.detalle ? { detalle: String(p.detalle) } : {})
    }));
  }
  return [{ metodo: normalizarMetodo(venta?.metodoPago), monto: Number(venta?.total) || 0 }];
}

/** Valor que se guarda en venta.metodoPago: el medio, o 'mixto' si son varios */
export function metodoResumen(pagos: { metodo: string }[]): string {
  return pagos.length === 1 ? pagos[0].metodo : 'mixto';
}

/** Texto para listados/tickets: "Efectivo" o "Efectivo $54.000 + Tarjeta $40.000" */
export function textoPagos(venta: any, moneda: (n: number) => string): string {
  const pagos = pagosDeVenta(venta);
  const op = (p: { detalle?: string }) => p.detalle ? ` (${p.detalle})` : '';
  if (pagos.length === 1) {
    return nombreMetodo(Array.isArray(venta?.pagos) && venta.pagos.length ? venta.pagos[0].metodo : venta?.metodoPago) + op(pagos[0]);
  }
  return pagos.map(p => `${nombreMetodo(p.metodo)} ${moneda(p.monto)}${op(p)}`).join(' + ');
}

/** Máximo de caracteres del detalle de un pago con tarjeta */
export const MAX_DETALLE_PAGO = 120;

/** Limpia el detalle que escribió el cajero ('' si no hay) */
export function limpiarDetalle(texto: any): string {
  return String(texto ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_DETALLE_PAGO);
}

/** Agrega el detalle (nº de operación del posnet) al pago con tarjeta. Si está vacío no agrega nada. */
export function conDetalleTarjeta<T extends { metodo: string }>(pagos: T[], detalle: any): (T & { detalle?: string })[] {
  const d = limpiarDetalle(detalle);
  return pagos.map(p => p.metodo === 'tarjeta' && d ? { ...p, detalle: d } : p);
}

/** Importe pagado en efectivo (el que mueve la caja física) */
export function efectivoDeVenta(venta: any): number {
  return r2(pagosDeVenta(venta).filter(p => p.metodo === 'efectivo').reduce((a, p) => a + p.monto, 0));
}

/** Pagos con los que entró dinero (sin cuenta corriente, crédito de la casa ni plan canje) */
export function pagosEnCaja(venta: any): { metodo: MetodoNormalizado; monto: number; detalle?: string }[] {
  return pagosDeVenta(venta).filter(p => !METODOS_SIN_DINERO.includes(p.metodo));
}

/** Parte de la venta financiada con el crédito de la casa */
export function creditoDeVenta(venta: any): number {
  return r2(pagosDeVenta(venta).filter(p => p.metodo === 'creditocasa').reduce((a, p) => a + p.monto, 0));
}

/** Parte de la venta pagada con un equipo usado (plan canje) */
export function canjeDeVenta(venta: any): number {
  return r2(pagosDeVenta(venta).filter(p => p.metodo === 'canje').reduce((a, p) => a + p.monto, 0));
}

/** Parte de la venta que quedó a cuenta corriente (deuda del cliente) */
export function aCuentaDeVenta(venta: any): number {
  return r2(pagosDeVenta(venta).filter(p => p.metodo === 'cuentacorriente').reduce((a, p) => a + p.monto, 0));
}

/** ¿Es el cobro de una deuda de cuenta corriente? (no es una venta: no se cuenta como vendido) */
export function esCobroCuenta(venta: any): boolean {
  return venta?.tipoVenta === 'cobrocuenta';
}

/** ¿Es el cobro de cuotas del crédito de la casa? (no es una venta: la venta se contó al financiar) */
export function esCobroCuota(venta: any): boolean {
  return venta?.tipoVenta === 'cobrocuota' || venta?.tipoVenta === 'refinanciacion';   // 🔁 la entrega de una refinanciación también
}

/** Cobro de una deuda (cuenta corriente o cuotas): entra a la caja pero no es una venta nueva */
export function esCobroDeuda(venta: any): boolean {
  return esCobroCuenta(venta) || esCobroCuota(venta);
}
