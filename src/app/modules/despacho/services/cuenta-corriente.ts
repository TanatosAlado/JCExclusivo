/**
 * Cuenta corriente de clientes (mayoristas): funciones puras, sin Angular, para poder probarlas.
 *
 * Modelo en Firestore:
 *   CuentasCorrientes/{clienteId}                  → saldo y datos del cliente
 *   CuentasCorrientes/{clienteId}/Movimientos/{id} → cargos (compras a cuenta) y pagos
 *     - El id del movimiento es el id de la venta (ticket) que lo generó.
 *     - Cargo: importe, pendiente (lo que falta pagar de esa compra), saldada.
 *     - Pago:  importe, aplicaciones (a qué compras se imputó y cuánto).
 *
 * Los pagos parciales se imputan a las compras MÁS VIEJAS primero (FIFO).
 */

export interface CargoPendiente {
  id: string;
  fecha: string;        // ISO
  pendiente: number;
  nroTicket?: number | null;
}

export interface Aplicacion {
  cargoId: string;
  nroTicket: number | null;
  fecha: string;
  importe: number;          // cuánto de este pago se imputó a esa compra
  pendienteAnterior: number;
  pendienteNuevo: number;
}

export type EstadoCargo = 'pendiente' | 'parcial' | 'pagado' | 'anulado';

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** Reparte un pago entre las compras pendientes, de la más vieja a la más nueva */
export function imputarFIFO(cargos: CargoPendiente[], importe: number): { aplicaciones: Aplicacion[]; sobrante: number } {
  let resto = r2(importe);
  const aplicaciones: Aplicacion[] = [];
  const ordenados = [...cargos]
    .filter(c => r2(c.pendiente) > 0)
    .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)) || a.id.localeCompare(b.id));

  for (const c of ordenados) {
    if (resto <= 0) break;
    const pendiente = r2(c.pendiente);
    const aplicado = r2(Math.min(pendiente, resto));
    aplicaciones.push({
      cargoId: c.id,
      nroTicket: c.nroTicket ?? null,
      fecha: c.fecha,
      importe: aplicado,
      pendienteAnterior: pendiente,
      pendienteNuevo: r2(pendiente - aplicado)
    });
    resto = r2(resto - aplicado);
  }
  return { aplicaciones, sobrante: resto };
}

/** Estado de una compra a cuenta */
export function estadoCargo(m: { anulado?: boolean; importe?: number; pendiente?: number }): EstadoCargo {
  if (m?.anulado) return 'anulado';
  const pendiente = r2(Number(m?.pendiente));
  if (pendiente <= 0) return 'pagado';
  return pendiente < r2(Number(m?.importe)) ? 'parcial' : 'pendiente';
}

export function nombreEstadoCargo(e: EstadoCargo): string {
  return { pendiente: 'Pendiente', parcial: 'Pago parcial', pagado: 'Pagado', anulado: 'Anulado' }[e];
}

/** Días desde una fecha ISO hasta hoy (antigüedad de la deuda) */
export function diasDesde(fechaIso: string, hoy = new Date()): number {
  const f = new Date(fechaIso);
  if (isNaN(f.getTime())) return 0;
  return Math.max(0, Math.floor((hoy.getTime() - f.getTime()) / 86400000));
}

export const redondear = r2;
