/**
 * 🔧 Reparaciones del cliente en "Mi cuenta" (funciones puras, se prueban sin Angular). Solo para ver.
 *  - En curso: órdenes pendientes (en reparación o ya listas para retirar).
 *  - Historial: órdenes entregadas (finalizadas). Las eliminadas no se muestran.
 */

export type EstadoReparacionCliente = 'en-reparacion' | 'lista' | 'entregada';

export interface ReparacionCliente {
  id: string;
  numero: number | null;
  equipo: string;
  imei: string;
  color: string;
  motivo: string;
  estado: EstadoReparacionCliente;
  fechaIngreso: Date | null;
  fechaListo: Date | null;          // cuándo el taller terminó el trabajo
  fechaEntrega: Date | null;
  presupuesto: number | null;       // solo el total
  garantiaHasta: Date | null;
  enGarantia: boolean;              // la garantía todavía corre
  esGarantia: boolean;              // la orden es un reingreso por garantía
}

/** Timestamp de Firestore, Date, ISO o "dd/MM/yyyy" */
export function fechaReparacion(v: any): Date | null {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v?.toDate === 'function') return v.toDate();
  if (typeof v?.seconds === 'number') return new Date(v.seconds * 1000);
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/** Arma lo que ve el cliente de una orden */
export function armarReparacionCliente(id: string, o: any, finalizada: boolean, hoy = new Date()): ReparacionCliente {
  const fechaEntrega = fechaReparacion(o?.fechaEntrega);
  let garantiaHasta = fechaReparacion(o?.fechaGarantia);
  const dias = Number(o?.diasGarantia) || 0;
  if (!garantiaHasta && finalizada && fechaEntrega && dias > 0) {
    garantiaHasta = new Date(fechaEntrega.getFullYear(), fechaEntrega.getMonth(), fechaEntrega.getDate() + dias);
  }
  const fechaListo = fechaReparacion(o?.trabajoTerminado?.fecha);
  const presupuesto = Number(o?.presupuesto);
  return {
    id,
    numero: Number(o?.numeroOrden) || null,
    equipo: String(o?.equipo || 'Equipo').trim(),
    imei: String(o?.imei || '').trim(),
    color: String(o?.colorEquipo || '').trim(),
    motivo: String(o?.motivoIngreso || '').trim(),
    estado: finalizada ? 'entregada' : (o?.trabajoTerminado ? 'lista' : 'en-reparacion'),
    fechaIngreso: fechaReparacion(o?.fechaIngreso),
    fechaListo,
    fechaEntrega,
    presupuesto: presupuesto > 0 ? presupuesto : null,
    garantiaHasta: finalizada ? garantiaHasta : null,
    enGarantia: finalizada && !!garantiaHasta && garantiaHasta.getTime() >= new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()).getTime(),
    esGarantia: o?.garantia === true
  };
}

/** En curso (las listas primero) y el historial (lo más reciente primero) */
export function separarReparaciones(lista: ReparacionCliente[]): { enCurso: ReparacionCliente[]; historial: ReparacionCliente[] } {
  const t = (d: Date | null) => d?.getTime() ?? 0;
  return {
    enCurso: lista.filter(r => r.estado !== 'entregada')
      .sort((a, b) => (a.estado === 'lista' ? 0 : 1) - (b.estado === 'lista' ? 0 : 1) || t(b.fechaIngreso) - t(a.fechaIngreso)),
    historial: lista.filter(r => r.estado === 'entregada')
      .sort((a, b) => t(b.fechaEntrega || b.fechaIngreso) - t(a.fechaEntrega || a.fechaIngreso))
  };
}
