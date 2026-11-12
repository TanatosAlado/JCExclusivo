/**
 * Mano de obra / repuestos de una reparación (funciones puras, se pueden probar sin Angular).
 *
 *  - La orden guarda manoObra y repuestos; el presupuesto es la suma.
 *    Las órdenes viejas no los tienen: quedan "sin discriminar".
 *  - Cada cobro cancela una parte de la mano de obra y otra de los repuestos, en la misma
 *    proporción que lo que falta pagar de cada uno (así, con seña + saldo, al final cierra justo).
 *  - El descuento por efectivo / transferencia sale de los REPUESTOS: la mano de obra se respeta.
 *    (Solo si el descuento es más grande que la parte de repuestos, lo que sobra sale de la mano de obra.)
 */

export interface DesgloseOrden {
  manoObra: number;
  repuestos: number;
}

/** Cómo se reparte un cobro */
export interface DesgloseCobro {
  manoObra: number;            // lo que entró a la caja por mano de obra
  repuestos: number;           // lo que entró a la caja por repuestos (ya con el descuento)
  manoObraCancelada: number;   // parte del saldo de mano de obra que cancela este cobro
  repuestosCancelado: number;  // parte del saldo de repuestos que cancela este cobro
}

const redondear = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const esNumero = (v: any) => typeof v === 'number' && isFinite(v);

/** null = orden sin discriminar (cargada antes de existir el dato, o sin presupuesto) */
export function desgloseDeOrden(orden: any): DesgloseOrden | null {
  if (!orden || !esNumero(orden.manoObra) || !esNumero(orden.repuestos)) return null;
  return { manoObra: Math.max(0, orden.manoObra), repuestos: Math.max(0, orden.repuestos) };
}

/**
 * Valores para guardar en la orden a partir de lo que se cargó en el formulario.
 * Si no se cargó ninguno de los dos, la orden queda sin discriminar (manoObra/repuestos = null)
 * y el presupuesto es el que se haya escrito a mano.
 */
export function datosPresupuesto(manoObra: any, repuestos: any, presupuestoManual: any):
  { presupuesto: number; manoObra: number | null; repuestos: number | null } {
  const vacio = (v: any) => v === null || v === undefined || String(v).trim() === '';
  if (vacio(manoObra) && vacio(repuestos)) {
    return { presupuesto: Math.max(0, redondear(Number(presupuestoManual) || 0)), manoObra: null, repuestos: null };
  }
  const mo = Math.max(0, redondear(Number(manoObra) || 0));
  const rep = Math.max(0, redondear(Number(repuestos) || 0));
  return { presupuesto: redondear(mo + rep), manoObra: mo, repuestos: rep };
}

/** Cobros vigentes de la orden */
function cobrosVigentes(orden: any): any[] {
  return (orden?.cobros || []).filter((c: any) => c && !c.anulado);
}

/**
 * Reparte un cobro entre mano de obra y repuestos.
 *  importe   = saldo de la orden que cancela (incluye el descuento)
 *  descuento = descuento por efectivo / transferencia (lo que no entra a la caja)
 * Devuelve null si la orden está sin discriminar.
 */
export function imputarCobroReparacion(orden: any, importe: number, descuento = 0): DesgloseCobro | null {
  const d = desgloseDeOrden(orden);
  if (!d) return null;

  const presupuesto = Number(orden.presupuesto) || 0;
  importe = Math.max(0, redondear(importe));
  descuento = Math.min(Math.max(0, redondear(descuento)), importe);

  // Lo que ya se canceló de mano de obra (los cobros de antes de discriminar se toman en proporción)
  const proporcionMo = presupuesto > 0 ? d.manoObra / presupuesto : 0;
  let pagado = 0, moCancelada = 0;
  for (const c of cobrosVigentes(orden)) {
    const monto = Number(c.monto) || 0;
    pagado += monto;
    moCancelada += esNumero(c.desglose?.manoObraCancelada) ? c.desglose.manoObraCancelada : monto * proporcionMo;
  }

  const saldo = Math.max(0, redondear(presupuesto - pagado));
  const moPendiente = Math.min(Math.max(0, redondear(d.manoObra - moCancelada)), saldo);

  // Proporción de lo pendiente; si cancela todo el saldo, se lleva todo lo que falta de mano de obra
  let moImporte = saldo <= 0 ? 0
    : importe >= saldo - 0.009 ? moPendiente
      : redondear(importe * moPendiente / saldo);
  moImporte = Math.min(moImporte, importe);
  const repImporte = redondear(importe - moImporte);

  // El descuento sale de los repuestos (si no alcanza, el resto de la mano de obra)
  const descRepuestos = Math.min(descuento, repImporte);
  const descManoObra = redondear(descuento - descRepuestos);

  return {
    manoObra: redondear(moImporte - descManoObra),
    repuestos: redondear(repImporte - descRepuestos),
    manoObraCancelada: moImporte,
    repuestosCancelado: repImporte
  };
}

/** Totales de mano de obra / repuestos / sin discriminar de un conjunto de cobros (ventas tipo 'reparacion') */
export function totalesDesglose(ventas: any[]): { manoObra: number; repuestos: number; sinDiscriminar: number } {
  let manoObra = 0, repuestos = 0, sinDiscriminar = 0;
  for (const v of ventas || []) {
    const des = v?.desglose;
    if (des && esNumero(des.manoObra) && esNumero(des.repuestos)) {
      manoObra += des.manoObra;
      repuestos += des.repuestos;
      // Ticket de varias órdenes: la parte de las órdenes sin discriminar viene aparte
      if (esNumero(des.sinDiscriminar)) sinDiscriminar += des.sinDiscriminar;
    } else {
      sinDiscriminar += Number(v?.total) || 0;
    }
  }
  return { manoObra: redondear(manoObra), repuestos: redondear(repuestos), sinDiscriminar: redondear(sinDiscriminar) };
}


// =====================================================
// VARIAS ÓRDENES EN UN MISMO COBRO
// =====================================================

/** Cuánto se lleva cada orden de un cobro */
export interface ParteCobroOrden {
  importe: number;     // saldo de la orden que cancela (incluye el descuento)
  descuento: number;   // parte del descuento por efectivo / transferencia
  cobrado: number;     // lo que entra a la caja por esta orden
}

/**
 * Reparte un cobro entre varias órdenes, ya ordenadas (la última es la de número más alto).
 * Todas se cancelan completas menos la última, que puede quedar con saldo.
 * El descuento se reparte en proporción a lo que cancela cada una.
 */
export function repartirCobroOrdenes(saldos: number[], importe: number, descuento = 0): { partes: ParteCobroOrden[] | null; error: string | null } {
  const n = (saldos || []).length;
  importe = redondear(importe);
  descuento = Math.min(Math.max(0, redondear(descuento)), importe);
  if (!n) return { partes: null, error: 'No hay órdenes para cobrar.' };
  if (!(importe > 0)) return { partes: null, error: 'El monto tiene que ser mayor a 0.' };
  const total = redondear(saldos.reduce((a, x) => a + (Number(x) || 0), 0));
  if (importe > total + 0.009) return { partes: null, error: 'El monto supera el saldo pendiente.' };
  const anteriores = redondear(saldos.slice(0, -1).reduce((a, x) => a + (Number(x) || 0), 0));
  const resto = redondear(importe - anteriores);
  if (n > 1 && resto <= 0.009) {
    return { partes: null, error: 'Con varias órdenes, todas se cancelan completas: solo la última puede quedar con saldo.' };
  }
  const importes = saldos.map((x, i) => i < n - 1 ? redondear(x) : Math.min(redondear(x), resto));
  let descRepartido = 0;
  const partes = importes.map((imp, i) => {
    const d = i < n - 1 ? redondear(descuento * imp / importe) : redondear(descuento - descRepartido);
    descRepartido = redondear(descRepartido + d);
    return { importe: imp, descuento: d, cobrado: redondear(imp - d) };
  });
  return { partes, error: null };
}

/** Desglose de un ticket de varias órdenes: suma de los de cada una (null si ninguna está discriminada) */
export function sumarDesgloses(partes: { desglose: DesgloseCobro | null; cobrado: number }[]):
  (DesgloseCobro & { sinDiscriminar: number }) | null {
  if (!partes.some(p => p.desglose)) return null;
  const t = { manoObra: 0, repuestos: 0, manoObraCancelada: 0, repuestosCancelado: 0, sinDiscriminar: 0 };
  for (const p of partes) {
    if (p.desglose) {
      t.manoObra += p.desglose.manoObra;
      t.repuestos += p.desglose.repuestos;
      t.manoObraCancelada += p.desglose.manoObraCancelada;
      t.repuestosCancelado += p.desglose.repuestosCancelado;
    } else {
      t.sinDiscriminar += Number(p.cobrado) || 0;
    }
  }
  return {
    manoObra: redondear(t.manoObra), repuestos: redondear(t.repuestos),
    manoObraCancelada: redondear(t.manoObraCancelada), repuestosCancelado: redondear(t.repuestosCancelado),
    sinDiscriminar: redondear(t.sinDiscriminar)
  };
}

/** Órdenes que cobra un ticket de reparación (los viejos tienen una sola, en venta.orden) */
export function ordenesDeVenta(v: any): { id: string; numeroOrden: any; equipo?: string; imei?: string }[] {
  if (Array.isArray(v?.ordenes) && v.ordenes.length) return v.ordenes;
  return v?.orden?.id ? [v.orden] : [];
}

/** "#1234" o "#1234, #1240" */
export function textoOrdenes(v: any): string {
  return ordenesDeVenta(v).map(o => '#' + (o.numeroOrden ?? '?')).join(', ');
}
