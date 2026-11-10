/**
 * CRÉDITO DE LA CASA (funciones puras, se prueban sin Angular).
 *
 * Venta financiada por el negocio, solo desde Despacho y solo con un equipo en el ticket:
 *   precio financiado (se puede cambiar al cobrar)
 *   − plan canje (equipo usado que entrega el cliente, opcional)
 *   − entrega (lo que paga en el momento, opcional)
 *   = saldo, en 1 a 6 cuotas IGUALES (si no da justo, la diferencia va en la última).
 * Las cuotas vencen del 1 al 10 de cada mes, empezando el mes siguiente a la compra.
 *
 * El crédito se guarda en Creditos/{ventaId}, con sus cuotas adentro.
 */

export const MAX_CUOTAS = 6;
export const DIA_DESDE = 1;
export const DIA_HASTA = 10;
export const MAX_DETALLE_CANJE = 150;

export interface CuotaCredito {
  numero: number;          // 1..n
  importe: number;
  pagado: number;          // lo pagado de esta cuota (0 al crearla)
  desde: string;           // 'YYYY-MM-DD' (día 1)
  hasta: string;           // 'YYYY-MM-DD' (día 10): vence ese día
}

export interface DatosCanje {
  monto: number;
  detalle: string;         // qué equipo entregó (modelo, IMEI…)
}

export interface CalculoCredito {
  precioContado: number;   // el total de la venta sin financiar
  precioFinanciado: number;
  recargo: number;         // financiado − contado (puede ser 0)
  canje: number;
  entrega: number;
  saldo: number;           // lo que se financia
  cuotas: CuotaCredito[];
}

export type EstadoCuota = 'pagada' | 'vencida' | 'por-vencer' | 'a-vencer';

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const vacio = (v: any) => v === null || v === undefined || String(v).trim() === '';

/** 'YYYY-MM-DD' en hora local */
function fechaLocal(anio: number, mes0: number, dia: number): string {
  const d = new Date(anio, mes0, dia);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Cuotas iguales; la primera vence el mes siguiente al de la compra (del 1 al 10) */
export function planCuotas(saldo: number, cantidad: number, fechaCompra: Date): CuotaCredito[] {
  const total = r2(saldo);
  const n = Math.floor(Number(cantidad));
  if (!(total > 0) || !(n >= 1)) return [];
  // Cuotas en pesos enteros; los centavos y lo que no da justo, en la última
  const base = n === 1 ? total : Math.floor(total / n);
  const cuotas: CuotaCredito[] = [];
  for (let i = 1; i <= n; i++) {
    const importe = i < n ? base : r2(total - base * (n - 1));
    cuotas.push({
      numero: i,
      importe,
      pagado: 0,
      desde: fechaLocal(fechaCompra.getFullYear(), fechaCompra.getMonth() + i, DIA_DESDE),
      hasta: fechaLocal(fechaCompra.getFullYear(), fechaCompra.getMonth() + i, DIA_HASTA)
    });
  }
  return cuotas;
}

/** Monto y detalle del plan canje (null si no se usa) */
export function validarCanje(usa: boolean, monto: any, detalle: any, totalVenta: number): { canje: DatosCanje | null; error: string | null } {
  if (!usa) return { canje: null, error: null };
  const n = Number(monto);
  if (vacio(monto) || !isFinite(n) || n <= 0) return { canje: null, error: 'Ingresá el monto que se le toma por el equipo del plan canje.' };
  if (r2(n) >= r2(totalVenta)) return { canje: null, error: 'El plan canje tiene que ser menor al total de la venta.' };
  const d = String(detalle ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_DETALLE_CANJE);
  if (d.length < 3) return { canje: null, error: 'Anotá qué equipo entrega en el plan canje (modelo, IMEI…).' };
  return { canje: { monto: r2(n), detalle: d }, error: null };
}

/** Datos del cliente que faltan para darle crédito */
export function datosFaltantes(cliente: { dni?: any; telefono?: any; direccion?: any } | null): string[] {
  if (!cliente) return ['cliente'];
  const faltan: string[] = [];
  if (vacio(cliente.dni)) faltan.push('DNI');
  if (vacio(cliente.telefono)) faltan.push('teléfono');
  if (vacio(cliente.direccion)) faltan.push('dirección');
  return faltan;
}

/**
 * Arma el crédito y valida todo. precioFinanciado vacío = precio de contado.
 * Devuelve el cálculo o el error a mostrar.
 */
export function calcularCredito(e: {
  precioContado: number;
  precioFinanciado: any;
  canje: number;
  entrega: any;
  cuotas: any;
  fecha: Date;
}): { calculo: CalculoCredito | null; error: string | null } {
  const contado = r2(e.precioContado);
  const financiado = vacio(e.precioFinanciado) ? contado : r2(Number(e.precioFinanciado));
  if (!isFinite(financiado) || financiado <= 0) return { calculo: null, error: 'El precio financiado tiene que ser mayor a 0.' };
  const canje = r2(e.canje);
  const entrega = vacio(e.entrega) ? 0 : r2(Number(e.entrega));
  if (!isFinite(entrega) || entrega < 0) return { calculo: null, error: 'La entrega no puede ser negativa.' };
  const saldo = r2(financiado - canje - entrega);
  if (saldo <= 0) {
    return { calculo: null, error: 'Con el canje y la entrega no queda nada para financiar: cobralo de contado.' };
  }
  const n = Number(e.cuotas);
  if (vacio(e.cuotas) || !Number.isInteger(n) || n < 1 || n > MAX_CUOTAS) {
    return { calculo: null, error: `Elegí la cantidad de cuotas (de 1 a ${MAX_CUOTAS}).` };
  }
  return {
    calculo: {
      precioContado: contado,
      precioFinanciado: financiado,
      recargo: r2(financiado - contado),
      canje,
      entrega,
      saldo,
      cuotas: planCuotas(saldo, n, e.fecha)
    },
    error: null
  };
}

/** Estado de una cuota a una fecha (por defecto, hoy) */
export function estadoCuota(c: CuotaCredito, hoy = new Date()): { estado: EstadoCuota; diasAtraso: number; falta: number } {
  const falta = r2((Number(c.importe) || 0) - (Number(c.pagado) || 0));
  if (falta <= 0.004) return { estado: 'pagada', diasAtraso: 0, falta: 0 };
  const dia = fechaLocal(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  if (dia > c.hasta) {
    const [a, m, d] = c.hasta.split('-').map(Number);
    const vence = new Date(a, m - 1, d);
    const hoy0 = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
    return { estado: 'vencida', diasAtraso: Math.round((hoy0.getTime() - vence.getTime()) / 86400000), falta };
  }
  if (dia >= c.desde) return { estado: 'por-vencer', diasAtraso: 0, falta };
  return { estado: 'a-vencer', diasAtraso: 0, falta };
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** "1 al 10 de diciembre de 2026" */
export function textoVencimiento(c: { desde: string; hasta: string }): string {
  const [a, m, d1] = c.desde.split('-').map(Number);
  const d2 = Number(c.hasta.split('-')[2]);
  return `${d1} al ${d2} de ${MESES[m - 1]} de ${a}`;
}

/** "diciembre 2026" */
export function mesCuota(c: { desde: string }): string {
  const [a, m] = c.desde.split('-').map(Number);
  return `${MESES[m - 1]} ${a}`;
}

// =====================================================
// COBRO DE CUOTAS
// =====================================================

export interface AplicacionCuota {
  numero: number;          // nº de cuota
  importe: number;         // lo que se le aplicó en este pago
  pendienteNuevo: number;  // lo que le queda a esa cuota después del pago
}

/** Lo que le falta pagar a una cuota */
export function faltaCuota(c: CuotaCredito | null | undefined): number {
  if (!c) return 0;
  return Math.max(0, r2((Number(c.importe) || 0) - (Number(c.pagado) || 0)));
}

/**
 * Aplica un pago a las cuotas, la más vieja primero (puede pagar una parte o adelantar varias).
 * Devuelve las cuotas actualizadas (copia), a cuáles se aplicó y lo que sobra (si supera el saldo).
 */
export function imputarCuotas(cuotas: CuotaCredito[], importe: number): { cuotas: CuotaCredito[]; aplicaciones: AplicacionCuota[]; sobrante: number } {
  let resta = r2(importe);
  const nuevas = (cuotas || []).map(c => ({ ...c })).sort((a, b) => a.numero - b.numero);
  const aplicaciones: AplicacionCuota[] = [];
  for (const c of nuevas) {
    if (resta <= 0.004) break;
    const falta = faltaCuota(c);
    if (falta <= 0.004) continue;
    const aplica = r2(Math.min(falta, resta));
    c.pagado = r2((Number(c.pagado) || 0) + aplica);
    resta = r2(resta - aplica);
    aplicaciones.push({ numero: c.numero, importe: aplica, pendienteNuevo: faltaCuota(c) });
  }
  return { cuotas: nuevas, aplicaciones, sobrante: Math.max(0, resta) };
}

/** Deshace un pago (anulación del ticket del cobro): a cada cuota se le resta lo que se le había aplicado */
export function revertirCuotas(cuotas: CuotaCredito[], aplicaciones: { numero: number; importe: number }[]): CuotaCredito[] {
  return (cuotas || []).map(c => {
    const a = (aplicaciones || []).filter(x => x.numero === c.numero).reduce((s, x) => s + (Number(x.importe) || 0), 0);
    return a ? { ...c, pagado: Math.max(0, r2((Number(c.pagado) || 0) - a)) } : { ...c };
  });
}

/** Saldo del crédito según sus cuotas */
export function saldoCuotas(cuotas: CuotaCredito[]): number {
  return r2((cuotas || []).reduce((a, c) => a + faltaCuota(c), 0));
}

export interface SituacionCredito {
  saldo: number;
  cuotasPagadas: number;
  cuotasVencidas: number;
  montoVencido: number;           // lo que debería haber pagado ya
  diasAtraso: number;             // de la cuota vencida más vieja
  proxima: CuotaCredito | null;   // la primera que falta pagar
  aPagarHoy: number;              // vencido + la cuota del mes si estamos del 1 al 10
  estado: 'al-dia' | 'por-vencer' | 'vencido' | 'cancelado';
}

/** Cómo está un crédito a una fecha (por defecto, hoy) */
export function situacionCredito(credito: { cuotas?: CuotaCredito[] }, hoy = new Date()): SituacionCredito {
  const cuotas = [...(credito?.cuotas || [])].sort((a, b) => a.numero - b.numero);
  let pagadas = 0, vencidas = 0, montoVencido = 0, diasAtraso = 0, porVencer = 0;
  let proxima: CuotaCredito | null = null;
  for (const c of cuotas) {
    const e = estadoCuota(c, hoy);
    if (e.estado === 'pagada') { pagadas++; continue; }
    if (!proxima) proxima = c;
    if (e.estado === 'vencida') { vencidas++; montoVencido += e.falta; diasAtraso = Math.max(diasAtraso, e.diasAtraso); }
    if (e.estado === 'por-vencer') porVencer += e.falta;
  }
  const saldo = saldoCuotas(cuotas);
  return {
    saldo,
    cuotasPagadas: pagadas,
    cuotasVencidas: vencidas,
    montoVencido: r2(montoVencido),
    diasAtraso,
    proxima,
    aPagarHoy: r2(montoVencido + porVencer),
    estado: saldo <= 0.004 ? 'cancelado' : vencidas ? 'vencido' : porVencer ? 'por-vencer' : 'al-dia'
  };
}

export interface ResumenCartera {
  vigentes: number;          // créditos con saldo
  cancelados: number;
  anulados: number;
  saldo: number;             // lo que falta cobrar de todos los vigentes
  vencido: number;           // de eso, lo que ya venció
  conAtraso: number;         // créditos con alguna cuota vencida
  esteMes: number;           // cuotas que vencen este mes (sin las ya vencidas de meses anteriores)
}

/** Totales de la cartera de créditos a una fecha (por defecto, hoy) */
export function resumenCartera(creditos: any[], hoy = new Date()): ResumenCartera {
  const mes = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
  const r: ResumenCartera = { vigentes: 0, cancelados: 0, anulados: 0, saldo: 0, vencido: 0, conAtraso: 0, esteMes: 0 };
  for (const c of creditos || []) {
    if (c?.estado === 'anulado') { r.anulados++; continue; }
    const s = situacionCredito(c, hoy);
    if (c?.estado === 'cancelado' || s.saldo <= 0.004) { r.cancelados++; continue; }
    r.vigentes++;
    r.saldo += s.saldo;
    r.vencido += s.montoVencido;
    if (s.cuotasVencidas) r.conAtraso++;
    r.esteMes += (c.cuotas || [])
      .filter((q: CuotaCredito) => String(q.desde).slice(0, 7) === mes)
      .reduce((a: number, q: CuotaCredito) => a + faltaCuota(q), 0);
  }
  r.saldo = r2(r.saldo); r.vencido = r2(r.vencido); r.esteMes = r2(r.esteMes);
  return r;
}
