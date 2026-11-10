/**
 * Cuenta entre el LOCAL y el TALLER (funciones puras, se pueden probar sin Angular).
 *
 * Las reparaciones se reciben y se cobran en el local; las hace el taller (sucursal interna).
 * Cuando el taller termina un trabajo carga su costo: el local queda debiéndoselo.
 * El local paga en efectivo (sale de su caja y entra en la del taller) o por transferencia,
 * y cada pago cancela primero las órdenes más viejas.
 */

import { imputarFIFO } from './cuenta-corriente';

export { imputarFIFO };

export interface SucursalRef {
  id: string;
  nombre: string;
}

export interface TrabajoTerminado {
  fecha: string;                  // ISO
  usuario: { uid: string; usuario: string; nombre: string };
  costoTaller: number;            // lo que el taller le cobra al local (puede ser 0)
  deudor: SucursalRef;            // sucursal que le paga al taller (el local)
  taller: SucursalRef;
  nota?: string;
  cargoId: string | null;         // movimiento de la cuenta (null si el costo fue 0)
  corregido?: { fecha: string; usuario: string; antes: number } | null;
}

export type MetodoPagoInterno = 'efectivo' | 'transferencia';

export const MAX_NOTA = 300;

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Sucursal del taller:
 *  - la marcada como taller (esTaller), o
 *  - si no hay ninguna marcada, la ÚNICA sucursal interna activa (sin retiro web).
 */
export function sucursalTaller(sucursales: any[]): SucursalRef | null {
  const activas = (sucursales || []).filter(s => s && s.id && s.activa !== false);
  const marcada = activas.find(s => s.esTaller === true);
  const elegida = marcada || (() => {
    const internas = activas.filter(s => s.retiroWeb === false);
    return internas.length === 1 ? internas[0] : null;
  })();
  return elegida ? { id: elegida.id, nombre: elegida.nombre || 'Taller' } : null;
}

/** Sucursales que le pueden deber al taller (las activas que no son el taller) */
export function sucursalesDeudoras(sucursales: any[], tallerId: string | null): SucursalRef[] {
  return (sucursales || [])
    .filter(s => s && s.id && s.activa !== false && s.id !== tallerId && s.retiroWeb !== false)
    .map(s => ({ id: s.id, nombre: s.nombre || s.id }));
}

/** Documento de la cuenta: una por par (quien debe → a quien) */
export function idCuenta(deudorId: string, acreedorId: string): string {
  return `${deudorId}__${acreedorId}`;
}

/** Costo del taller: número >= 0, con centavos */
export function validarCosto(valor: any): number {
  const n = Number(valor);
  if (valor === null || valor === undefined || String(valor).trim() === '' || !isFinite(n)) {
    throw new Error('Ingresá el costo del taller (puede ser 0 si no se cobra).');
  }
  if (n < 0) throw new Error('El costo del taller no puede ser negativo.');
  if (n > 100000000) throw new Error('El costo del taller es demasiado alto. Revisalo.');
  return r2(n);
}

/** Importe de un pago: mayor a 0 y sin pasarse de lo que se debe */
export function validarPago(valor: any, saldo: number): number {
  const n = r2(Number(valor));
  if (!(n > 0)) throw new Error('El importe del pago tiene que ser mayor a 0.');
  if (n > r2(saldo) + 0.009) throw new Error(`El pago supera lo que se debe ($${r2(saldo).toFixed(2)}).`);
  return n;
}

/** Ganancia del local en una orden: lo que se le cobra al cliente − costo del taller */
export function gananciaLocal(presupuesto: any, costoTaller: any): number {
  return r2((Number(presupuesto) || 0) - (Number(costoTaller) || 0));
}

/** Nombre del cliente de la orden */
export function clienteDeOrden(orden: any): string {
  return [orden?.nombreCliente, orden?.apellidoCliente].filter(Boolean).join(' ') || 'Cliente';
}

/** Saldo calculado a partir de los movimientos (para verificar contra el guardado) */
export function saldoDeMovimientos(movs: any[]): number {
  return r2((movs || [])
    .filter(m => m && m.anulado !== true && m.tipo === 'cargo')
    .reduce((acc, m) => acc + (Number(m.pendiente) || 0), 0));
}
