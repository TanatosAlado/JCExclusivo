/**
 * 🏠 Créditos de la casa, como los ve el cliente en "Mi cuenta" (funciones puras, se prueban sin Angular).
 * Solo para consultar: los pagos se hacen en el local.
 */
import {
  CuotaCredito, EstadoCuota, estadoCuota, faltaCuota, RECARGO_DIARIO, situacionCredito, SituacionCredito, textoVencimiento
} from 'src/app/modules/despacho/services/credito-casa';

export interface CuotaCliente {
  numero: number;
  importe: number;
  pagado: number;
  falta: number;
  desde: string;
  hasta: string;
  vence: string;                 // "1 al 10 de diciembre de 2026"
  estado: EstadoCuota;
  diasAtraso: number;
  fechaPago: string | null;      // cuándo se terminó de pagar (si está pagada)
}

export interface PagoCreditoCliente {
  fecha: string | null;
  nroTicket: number | null;
  importe: number;               // lo que bajó de la deuda
  recargo: number;               // recargo por atraso que pagó
  cuotas: number[];              // a qué cuotas se aplicó
  anterior: boolean;             // pago de antes del sistema (sin ticket)
}

export interface CreditoCliente {
  id: string;
  nroTicket: number | null;
  fecha: string | null;
  detalle: string;               // los equipos
  estado: 'vigente' | 'cancelado' | 'refinanciado';
  situacion: SituacionCredito;
  importe: number;               // lo financiado
  pagado: number;
  saldo: number;
  cantidadCuotas: number;
  cuotas: CuotaCliente[];
  pagos: PagoCreditoCliente[];   // los más nuevos primero
  esRefinanciacion: boolean;
  /** Si se refinanció: el ticket del crédito nuevo que lo reemplaza */
  refinanciadoEn: number | null;
}

export const RECARGO_DIARIO_CLIENTE = RECARGO_DIARIO;

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const texto = (f: any) => (f ? String(f) : null);

/** Arma lo que ve el cliente de un crédito (null si está anulado) */
export function armarCreditoCliente(credito: any, pagosCrudos: any[], hoy = new Date()): CreditoCliente | null {
  if (!credito || credito.estado === 'anulado' || credito.anulado) return null;
  const cuotasCrudas: CuotaCredito[] = [...(credito.cuotas || [])].sort((a: any, b: any) => a.numero - b.numero);

  const pagos: PagoCreditoCliente[] = (pagosCrudos || [])
    .filter(p => p && p.anulado !== true)
    .map((p): PagoCreditoCliente => ({
      fecha: texto(p.fecha),
      nroTicket: p.nroTicket ?? null,
      importe: r2(p.importe),
      recargo: r2(p.recargo),
      cuotas: [...new Set<number>((p.aplicaciones || []).filter((a: any) => Number(a?.importe) > 0).map((a: any) => Number(a.numero)))]
        .sort((a, b) => a - b),
      anterior: p.anterior === true
    }))
    .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));

  // Fecha del último pago aplicado a cada cuota (la que la terminó de pagar)
  const ultimoPagoCuota = new Map<number, string>();
  for (const p of [...pagos].reverse()) {
    if (!p.fecha) continue;
    for (const n of p.cuotas) ultimoPagoCuota.set(n, p.fecha);
  }

  const refinanciado = credito.estado === 'refinanciado';
  const cuotas: CuotaCliente[] = cuotasCrudas.map((c): CuotaCliente => {
    const e = estadoCuota(c, hoy);
    return {
      numero: c.numero,
      importe: r2(c.importe),
      pagado: r2(c.pagado),
      falta: faltaCuota(c),
      desde: c.desde,
      hasta: c.hasta,
      vence: textoVencimiento(c),
      estado: e.estado,
      diasAtraso: refinanciado ? 0 : e.diasAtraso,
      fechaPago: e.estado === 'pagada' ? (ultimoPagoCuota.get(c.numero) || null) : null
    };
  });

  const situacion = situacionCredito({ cuotas: cuotasCrudas }, hoy);
  const importe = r2(credito.importe);
  const saldo = refinanciado ? 0 : situacion.saldo;
  const estado: CreditoCliente['estado'] = refinanciado ? 'refinanciado'
    : (credito.estado === 'cancelado' || situacion.estado === 'cancelado') ? 'cancelado' : 'vigente';

  return {
    id: String(credito.id),
    nroTicket: credito.nroTicket ?? null,
    fecha: texto(credito.fecha),
    detalle: (credito.equipos || []).map((e: any) => e?.nombre).filter(Boolean).join(', ') || String(credito.detalle || 'Crédito'),
    estado,
    situacion,
    importe,
    pagado: r2(cuotasCrudas.reduce((a, c) => a + Math.min(Number(c.pagado) || 0, Number(c.importe) || 0), 0)),
    saldo,
    cantidadCuotas: cuotasCrudas.length,
    cuotas,
    pagos,
    esRefinanciacion: credito.origen === 'refinanciacion',
    refinanciadoEn: refinanciado ? (credito.refinanciado?.nroTicket ?? null) : null
  };
}

/** Orden: primero los que tienen deuda (los atrasados arriba), después los terminados; los más nuevos primero */
export function ordenarCreditosCliente(lista: CreditoCliente[]): CreditoCliente[] {
  const peso = (c: CreditoCliente) => c.estado !== 'vigente' ? 3 : c.situacion.estado === 'vencido' ? 0 : c.situacion.estado === 'por-vencer' ? 1 : 2;
  return [...lista].sort((a, b) => peso(a) - peso(b) || String(b.fecha || '').localeCompare(String(a.fecha || '')));
}

/** Totales para el resumen de la solapa */
export function resumenCreditosCliente(lista: CreditoCliente[]): { vigentes: number; saldo: number; vencido: number; aPagarHoy: number; proxima: { credito: CreditoCliente; cuota: CuotaCliente } | null } {
  const vigentes = lista.filter(c => c.estado === 'vigente');
  let proxima: { credito: CreditoCliente; cuota: CuotaCliente } | null = null;
  for (const c of vigentes) {
    const q = c.cuotas.find(x => x.estado !== 'pagada');
    if (q && (!proxima || q.hasta < proxima.cuota.hasta)) proxima = { credito: c, cuota: q };
  }
  return {
    vigentes: vigentes.length,
    saldo: r2(vigentes.reduce((a, c) => a + c.saldo, 0)),
    vencido: r2(vigentes.reduce((a, c) => a + c.situacion.montoVencido, 0)),
    aPagarHoy: r2(vigentes.reduce((a, c) => a + c.situacion.aPagarHoy, 0)),
    proxima
  };
}
