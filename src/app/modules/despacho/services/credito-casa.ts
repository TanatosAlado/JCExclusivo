/**
 * CRÉDITO DE LA CASA (funciones puras, se prueban sin Angular).
 *
 * Venta financiada por el negocio, solo desde Despacho y solo con un equipo en el ticket:
 *   precio de contado (se puede cambiar al cobrar)
 *   − plan canje (equipo usado que entrega el cliente, opcional)
 *   − entrega (lo que paga en el momento, opcional)
 *   = a financiar
 *   + interés del plan elegido (Gestiones → Créditos → Planes e interés), solo sobre lo financiado
 *   = saldo, en cuotas IGUALES (si no da justo, la diferencia va en la última).
 * Las cuotas vencen del 1 al 10 de cada mes, empezando el mes siguiente a la compra
 * (si se compra del 25 en adelante, el subsiguiente).
 * Pagada después del 10: recargo de 1% del importe de la cuota por cada día de atraso
 * (todos los días corridos: sábados, domingos y feriados incluidos). El cajero lo ve calculado y lo puede cambiar.
 *
 * El crédito se guarda en Creditos/{ventaId}, con sus cuotas adentro.
 */

export const MAX_CUOTAS = 24;
export const MAX_INTERES = 1000;   // % (tope de seguridad)

/** Plan de cuotas: cantidad e interés total en % sobre lo financiado */
export interface PlanCuotas {
  cuotas: number;
  interes: number;
}

/** Planes iniciales (se cambian en Gestiones → Créditos de la casa → Planes e interés) */
export const PLANES_INICIALES: PlanCuotas[] = [
  { cuotas: 1, interes: 8 },
  { cuotas: 2, interes: 16 },
  { cuotas: 3, interes: 24 },
  { cuotas: 6, interes: 50 },
  { cuotas: 12, interes: 100 },
  { cuotas: 18, interes: 150 },
  { cuotas: 24, interes: 210 }
];

/** Revisa y ordena los planes. Devuelve los planes limpios o el error a mostrar. */
export function validarPlanes(planes: any[]): { planes: PlanCuotas[] | null; error: string | null } {
  const lista = (planes || []).map(p => ({ cuotas: Number(p?.cuotas), interes: p?.interes === '' || p?.interes === null || p?.interes === undefined ? NaN : Number(p.interes) }));
  if (!lista.length) return { planes: null, error: 'Tiene que haber al menos un plan.' };
  for (const p of lista) {
    if (!Number.isInteger(p.cuotas) || p.cuotas < 1 || p.cuotas > MAX_CUOTAS) {
      return { planes: null, error: `La cantidad de cuotas tiene que ser un número entero de 1 a ${MAX_CUOTAS}.` };
    }
    if (!isFinite(p.interes) || p.interes < 0 || p.interes > MAX_INTERES) {
      return { planes: null, error: `Revisá el interés del plan de ${p.cuotas} cuota(s): tiene que ser de 0 a ${MAX_INTERES}%.` };
    }
  }
  const repetida = lista.find((p, i) => lista.findIndex(x => x.cuotas === p.cuotas) !== i);
  if (repetida) return { planes: null, error: `El plan de ${repetida.cuotas} cuota(s) está repetido.` };
  return { planes: lista.map(p => ({ cuotas: p.cuotas, interes: r2(p.interes) })).sort((a, b) => a.cuotas - b.cuotas), error: null };
}

/** Total con interés: lo financiado × (1 + interés %) */
export function conInteres(monto: number, interes: number): number {
  return r2((Number(monto) || 0) * (1 + (Number(interes) || 0) / 100));
}
export const DIA_DESDE = 1;
export const DIA_HASTA = 10;
/** Desde este día del mes, la primera cuota pasa al mes subsiguiente */
export const DIA_CORTE_PRIMERA_CUOTA = 25;
/** % de recargo por día de atraso (corrido), sobre el importe de la cuota */
export const RECARGO_DIARIO = 1;

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
  equipoId?: string;       // si se dio de alta en Equipos (queda "En preparación")
}

export interface CalculoCredito {
  precioLista: number;     // el total de la venta de contado (sin tocar)
  precioContado: number;   // el de contado con el que se vendió (se puede ajustar al cobrar)
  precioFinanciado: number;// lo que termina pagando: canje + entrega + saldo
  recargo: number;         // el interés en pesos (saldo − aFinanciar)
  interes: number;         // % del plan
  canje: number;
  entrega: number;
  aFinanciar: number;      // contado − canje − entrega (sin interés)
  saldo: number;           // lo que se financia, con el interés
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

/** Cuántos meses después de la compra vence la primera cuota (1, o 2 si se compra del 25 en adelante) */
export function mesesHastaPrimeraCuota(fechaCompra: Date): number {
  return fechaCompra.getDate() >= DIA_CORTE_PRIMERA_CUOTA ? 2 : 1;
}

/** Cuotas iguales; la primera vence el mes siguiente (o el subsiguiente desde el 25), del 1 al 10 */
export function planCuotas(saldo: number, cantidad: number, fechaCompra: Date): CuotaCredito[] {
  const total = r2(saldo);
  const n = Math.floor(Number(cantidad));
  if (!(total > 0) || !(n >= 1)) return [];
  // Cuotas en pesos enteros; los centavos y lo que no da justo, en la última
  const base = n === 1 ? total : Math.floor(total / n);
  const cuotas: CuotaCredito[] = [];
  const desfase = mesesHastaPrimeraCuota(fechaCompra) - 1;
  for (let i = 1; i <= n; i++) {
    const importe = i < n ? base : r2(total - base * (n - 1));
    const mes = fechaCompra.getMonth() + i + desfase;
    cuotas.push({
      numero: i,
      importe,
      pagado: 0,
      desde: fechaLocal(fechaCompra.getFullYear(), mes, DIA_DESDE),
      hasta: fechaLocal(fechaCompra.getFullYear(), mes, DIA_HASTA)
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
  precioLista: number;     // total de contado de la venta
  precioContado: any;      // ajustado al cobrar (vacío = el de lista)
  canje: number;
  entrega: any;
  cuotas: any;
  planes: PlanCuotas[];
  fecha: Date;
}): { calculo: CalculoCredito | null; error: string | null } {
  const lista = r2(e.precioLista);
  const contado = vacio(e.precioContado) ? lista : r2(Number(e.precioContado));
  if (!isFinite(contado) || contado <= 0) return { calculo: null, error: 'El precio de contado tiene que ser mayor a 0.' };
  const canje = r2(e.canje);
  const entrega = vacio(e.entrega) ? 0 : r2(Number(e.entrega));
  if (!isFinite(entrega) || entrega < 0) return { calculo: null, error: 'La entrega no puede ser negativa.' };
  const aFinanciar = r2(contado - canje - entrega);
  if (aFinanciar <= 0) {
    return { calculo: null, error: 'Con el canje y la entrega no queda nada para financiar: cobralo de contado.' };
  }
  const n = Number(e.cuotas);
  const plan = (e.planes || []).find(p => p.cuotas === n);
  if (vacio(e.cuotas) || !plan) {
    return { calculo: null, error: 'Elegí el plan de cuotas.' };
  }
  const saldo = conInteres(aFinanciar, plan.interes);
  return {
    calculo: {
      precioLista: lista,
      precioContado: contado,
      precioFinanciado: r2(canje + entrega + saldo),
      recargo: r2(saldo - aFinanciar),
      interes: plan.interes,
      canje,
      entrega,
      aFinanciar,
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
  refinanciados?: number;    // créditos que se reemplazaron por una refinanciación (no suman: suma el nuevo)
}

/** Totales de la cartera de créditos a una fecha (por defecto, hoy) */
export function resumenCartera(creditos: any[], hoy = new Date()): ResumenCartera {
  const mes = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
  const r: ResumenCartera = { vigentes: 0, cancelados: 0, anulados: 0, saldo: 0, vencido: 0, conAtraso: 0, esteMes: 0 };
  for (const c of creditos || []) {
    if (c?.estado === 'anulado') { r.anulados++; continue; }
    if (c?.estado === 'refinanciado') { r.refinanciados = (r.refinanciados || 0) + 1; continue; }
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


// =====================================================
// RECARGO POR ATRASO (1% por día corrido, sobre el importe de la cuota)
// =====================================================

/** Días corridos DESPUÉS del vencimiento y hasta hoy inclusive (todos: sábados, domingos y feriados también) */
export function diasAtrasoCorridos(hasta: string, hoy: Date): number {
  const [a, m, d] = String(hasta || '').split('-').map(Number);
  if (!a || !m || !d) return 0;
  const fin = Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  const vence = Date.UTC(a, m - 1, d);
  return Math.max(0, Math.round((fin - vence) / 86400000));
}

/** @deprecated el nombre quedó de cuando se contaban solo días hábiles: ahora cuenta días corridos */
export const diasHabilesAtraso = diasAtrasoCorridos;

export interface RecargoCuota {
  numero: number;
  dias: number;        // días (corridos) de atraso
  recargo: number;     // importe × 1% × días
}

/**
 * Recargo sugerido para las cuotas que se pagan (las vencidas a las que se les aplica el pago).
 * Interés simple: 1% del importe ORIGINAL de la cuota por día corrido de atraso. En pesos enteros.
 */
export function recargoPorAtraso(
  cuotas: CuotaCredito[], numerosQueSePagan: number[], hoy = new Date(), tasa = RECARGO_DIARIO
): { total: number; detalle: RecargoCuota[] } {
  const detalle: RecargoCuota[] = [];
  for (const c of cuotas || []) {
    if (!(numerosQueSePagan || []).includes(c.numero)) continue;
    const dias = diasAtrasoCorridos(c.hasta, hoy);
    if (dias <= 0) continue;
    detalle.push({ numero: c.numero, dias, recargo: Math.round((Number(c.importe) || 0) * tasa / 100 * dias) });
  }
  return { total: detalle.reduce((a, d) => a + d.recargo, 0), detalle };
}


// =====================================================
// CRÉDITOS CARGADOS A MANO (los que se dieron antes del sistema)
// =====================================================

/** Hasta cuántas cuotas puede tener un crédito cargado a mano (los viejos llegan a 48) */
export const MAX_CUOTAS_MANUAL = 60;

/** Datos del formulario "Cargar crédito existente" */
export interface DatosCreditoManual {
  nombre: string;
  dni?: any;
  telefono?: string;
  direccion?: string;
  equipo: string;
  imei?: string;
  detalle?: string;          // el acuerdo, en texto libre ("entregó 200 USD y 6 cuotas de…")
  fechaEntrega: string;      // 'YYYY-MM-DD'
  entrega?: any;             // lo que pagó al llevarse el equipo (informativo)
  cantidadCuotas: any;
  importeCuota: any;
  primerMes: string;         // 'YYYY-MM': mes de la cuota 1
}

/** Mes de la primera cuota que se propone para una entrega ('YYYY-MM'): igual que en una venta nueva */
export function primerMesSugerido(fechaEntrega: string): string {
  const [a, m, d] = String(fechaEntrega || '').split('-').map(Number);
  const f = a && m && d ? new Date(a, m - 1, d) : new Date();
  return fechaLocal(f.getFullYear(), f.getMonth() + mesesHastaPrimeraCuota(f), 1).slice(0, 7);
}

/** Cuotas de un crédito cargado a mano: todas del mismo importe, del 1 al 10 */
export function cuotasManuales(cantidad: number, importeCuota: number, primerMes: string): CuotaCredito[] {
  const n = Math.floor(Number(cantidad));
  const [a, m] = String(primerMes || '').split('-').map(Number);
  if (!(n >= 1) || !a || !m || !(Number(importeCuota) > 0)) return [];
  const cuotas: CuotaCredito[] = [];
  for (let i = 1; i <= n; i++) {
    cuotas.push({
      numero: i,
      importe: r2(importeCuota),
      pagado: 0,
      desde: fechaLocal(a, m - 1 + i - 1, DIA_DESDE),
      hasta: fechaLocal(a, m - 1 + i - 1, DIA_HASTA)
    });
  }
  return cuotas;
}

/** Revisa el formulario. Devuelve las cuotas armadas o el primer error a mostrar. */
export function validarCreditoManual(d: DatosCreditoManual): { cuotas: CuotaCredito[] | null; error: string | null } {
  const err = (e: string) => ({ cuotas: null, error: e });
  if (vacio(d?.nombre) || String(d.nombre).trim().length < 3) return err('Ingresá el nombre del cliente.');
  if (vacio(d.equipo)) return err('Ingresá el equipo.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.fechaEntrega || ''))) return err('Ingresá la fecha de entrega.');
  if (String(d.fechaEntrega) > fechaLocal(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())) {
    return err('La fecha de entrega no puede ser posterior a hoy.');
  }
  const n = Number(d.cantidadCuotas);
  if (!Number.isInteger(n) || n < 1 || n > MAX_CUOTAS_MANUAL) return err(`La cantidad de cuotas tiene que ser de 1 a ${MAX_CUOTAS_MANUAL}.`);
  if (!(Number(d.importeCuota) > 0)) return err('Ingresá el importe de la cuota.');
  if (!vacio(d.entrega) && !(Number(d.entrega) >= 0)) return err('La entrega no puede ser negativa.');
  if (!/^\d{4}-\d{2}$/.test(String(d.primerMes || ''))) return err('Elegí el mes de la primera cuota.');
  if (String(d.primerMes) < String(d.fechaEntrega).slice(0, 7)) return err('La primera cuota no puede vencer antes del mes de la entrega.');
  const cuotas = cuotasManuales(n, Number(d.importeCuota), d.primerMes);
  return cuotas.length ? { cuotas, error: null } : err('Revisá los datos de las cuotas.');
}

// =====================================================
// BLOQUEO POR CARTA DOCUMENTO
// =====================================================

export interface CartaDocumento {
  fecha: string;             // 'YYYY-MM-DD': cuándo se envió
  observacion: string;
  registrada: string;        // ISO: cuándo se cargó en el sistema
  usuario: string;
}

export interface BloqueoCredito {
  desde: string;             // ISO
  motivo: string;
  usuario: string;
}

/** Bloqueado = se le mandó carta documento y todavía no se desbloqueó (igual se le pueden cobrar cuotas) */
export function estaBloqueado(c: { bloqueo?: BloqueoCredito | null; estado?: string } | null | undefined): boolean {
  return !!c?.bloqueo && c.estado !== 'anulado';
}

/** La última carta documento enviada (o null) */
export function ultimaCarta(c: { cartasDocumento?: CartaDocumento[] } | null | undefined): CartaDocumento | null {
  const l = [...(c?.cartasDocumento || [])].sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)) || String(a.registrada).localeCompare(String(b.registrada)));
  return l.length ? l[l.length - 1] : null;
}

/** "dd/mm/yyyy" de una fecha 'YYYY-MM-DD' */
export function fechaCorta(f: string): string {
  return String(f || '').slice(0, 10).split('-').reverse().join('/');
}


// =====================================================
// 🔁 REFINANCIACIÓN (saldo + recargo − entrega, con el interés del plan)
// =====================================================

/** Recargo por atraso sugerido al refinanciar: el de todas las cuotas vencidas a hoy */
export function recargoRefinanciacion(cuotas: CuotaCredito[], hoy = new Date()) {
  const vencidas = (cuotas || []).filter(c => estadoCuota(c, hoy).estado === 'vencida').map(c => c.numero);
  return recargoPorAtraso(cuotas, vencidas, hoy);
}

export interface CalculoRefinanciacion {
  saldo: number;           // lo que debía de las cuotas
  recargo: number;         // recargo por atraso que se suma (el cajero lo puede bajar o borrar)
  entrega: number;         // lo que paga ahora
  aRefinanciar: number;    // saldo + recargo − entrega
  interes: number;         // % del plan
  financiado: number;      // aRefinanciar con el interés: lo que va a pagar en cuotas
  cuotas: CuotaCredito[];
}

/** Arma la refinanciación. Devuelve el cálculo o el primer error a mostrar. */
export function calcularRefinanciacion(
  saldo: number, recargo: any, entrega: any, plan: PlanCuotas | null, fecha = new Date()
): { calculo: CalculoRefinanciacion | null; error: string | null } {
  const err = (e: string) => ({ calculo: null, error: e });
  const sal = r2(saldo);
  const rec = vacio(recargo) ? 0 : Number(recargo);
  const ent = vacio(entrega) ? 0 : Number(entrega);
  if (!(sal > 0)) return err('Este crédito no tiene saldo para refinanciar.');
  if (!isFinite(rec) || rec < 0) return err('El recargo no puede ser negativo.');
  if (!isFinite(ent) || ent < 0) return err('La entrega no puede ser negativa.');
  const aRefinanciar = r2(sal + r2(rec) - r2(ent));
  if (aRefinanciar <= 0.009) return err('Con esa entrega paga todo: cobralo como cuota, no hace falta refinanciar.');
  if (!plan || !(plan.cuotas >= 1)) return err('Elegí en cuántas cuotas se refinancia.');
  if (plan.cuotas > MAX_CUOTAS) return err(`Se puede refinanciar en hasta ${MAX_CUOTAS} cuotas.`);
  const financiado = conInteres(aRefinanciar, plan.interes);
  const cuotas = planCuotas(financiado, plan.cuotas, fecha);
  if (!cuotas.length) return err('Revisá los datos de la refinanciación.');
  return {
    calculo: { saldo: sal, recargo: r2(rec), entrega: r2(ent), aRefinanciar, interes: Number(plan.interes) || 0, financiado, cuotas },
    error: null
  };
}


// =====================================================
// ✏️ EDICIÓN DE UN CRÉDITO CARGADO A MANO
// =====================================================

/** Por encima de esta cantidad de cuotas se pide confirmar (un 6 mal tipeado como 60) */
export const CUOTAS_PARA_CONFIRMAR = 24;

/**
 * Vuelve a aplicar los pagos (no anulados) sobre cuotas nuevas, del más viejo al más nuevo
 * y siempre a la cuota más vieja que falta. Devuelve las cuotas con lo pagado y a qué cuotas fue cada pago.
 */
export function reimputarPagos(
  cuotasNuevas: CuotaCredito[],
  pagos: { id: string; importe: number; fecha: string; registrado?: string; anulado?: boolean }[]
): { cuotas: CuotaCredito[]; aplicaciones: { [pagoId: string]: AplicacionCuota[] }; pagado: number; error: string | null } {
  const vigentes = (pagos || []).filter(p => !p.anulado)
    .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)) || String(a.registrado || '').localeCompare(String(b.registrado || '')));
  const pagado = r2(vigentes.reduce((a, p) => a + (Number(p.importe) || 0), 0));
  const total = r2((cuotasNuevas || []).reduce((a, q) => a + (Number(q.importe) || 0), 0));
  let cuotas = (cuotasNuevas || []).map(q => ({ ...q, pagado: 0 }));
  if (pagado > total + 0.009) {
    return { cuotas, aplicaciones: {}, pagado, error: `Ya pagó ${pagado.toFixed(2)} y el crédito corregido suma ${total.toFixed(2)}: no puede quedar por debajo de lo pagado.` };
  }
  const aplicaciones: { [pagoId: string]: AplicacionCuota[] } = {};
  for (const p of vigentes) {
    const imp = imputarCuotas(cuotas, Number(p.importe) || 0);
    cuotas = imp.cuotas;
    aplicaciones[p.id] = imp.aplicaciones;
  }
  return { cuotas, aplicaciones, pagado, error: null };
}
