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
    } else {
      sinDiscriminar += Number(v?.total) || 0;
    }
  }
  return { manoObra: redondear(manoObra), repuestos: redondear(repuestos), sinDiscriminar: redondear(sinDiscriminar) };
}
