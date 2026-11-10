import { Injectable } from '@angular/core';
import { getApp } from 'firebase/app';
import { getFunctions, httpsCallable } from 'firebase/functions';

/** Lo que devuelve la función analyticsTienda (functions/analytics-panel.js) */
export interface TotalesAnalytics {
  usuarios: number;
  nuevos: number;
  sesiones: number;
  vistas: number;
  interaccion: number;      // 0 a 1
  duracionMedia: number;    // segundos
  compras: number;
  ingresos: number;
}

export interface PanelAnalytics {
  rango: { desde: string; hasta: string; anterior: { desde: string; hasta: string } };
  totales: TotalesAnalytics;
  anterior: TotalesAnalytics | null;
  porDia: { fecha: string; usuarios: number; sesiones: number; vistas: number }[];
  embudo: { evento: string; nombre: string; eventos: number; usuarios: number }[];
  productos: { nombre: string; vistos: number; agregados: number; comprados: number }[];
  busquedas: { termino: string; veces: number }[];
  canales: { nombre: string; sesiones: number }[];
  fuentes: { nombre: string; sesiones: number }[];
  dispositivos: { nombre: string; usuarios: number }[];
  ciudades: { nombre: string; usuarios: number }[];
  paginas: { ruta: string; nombre: string; vistas: number }[];
  ahora: number | null;
  generado: string;
  desdeCache: boolean;
}

/** Motivos por los que el panel todavía no puede mostrar datos (cada uno tiene su paso de configuración) */
export type MotivoConfiguracion =
  'sin-configurar' | 'api-desactivada' | 'sin-permiso-ga' | 'propiedad-incorrecta' | 'sin-funcion';

export class AnalyticsPanelError extends Error {
  constructor(
    message: string,
    public motivo: MotivoConfiguracion | 'permiso' | 'cuota' | 'otro',
    /** Mensaje original de Google (para diagnosticar) */
    public detalle = ''
  ) {
    super(message);
  }
}

const MOTIVOS_CONFIG: MotivoConfiguracion[] = ['sin-configurar', 'api-desactivada', 'sin-permiso-ga', 'propiedad-incorrecta'];

/** Fecha local → "YYYY-MM-DD" */
export function fechaISO(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Datos de Google Analytics para el panel de Gestiones.
 * Se piden a la función de Firebase "analyticsTienda" (la credencial de Google queda en el servidor).
 */
@Injectable({ providedIn: 'root' })
export class AnalyticsPanelService {

  private funcion = httpsCallable<any, PanelAnalytics>(
    getFunctions(getApp(), 'us-central1'), 'analyticsTienda', { timeout: 70000 }
  );

  async obtener(desde: Date, hasta: Date, forzar = false): Promise<PanelAnalytics> {
    try {
      const res = await this.funcion({ desde: fechaISO(desde), hasta: fechaISO(hasta), forzar });
      return res.data;
    } catch (err: any) {
      throw this.traducir(err);
    }
  }

  private traducir(err: any): AnalyticsPanelError {
    const e = this.traducirSinDetalle(err);
    const det = err?.details;
    e.detalle = [det?.detalle, det?.propiedad ? `Propiedad consultada: ${det.propiedad}` : ''].filter(Boolean).join(' · ');
    return e;
  }

  private traducirSinDetalle(err: any): AnalyticsPanelError {
    const codigo = String(err?.code || '').replace(/^functions\//, '');
    const mensaje = String(err?.message || '');
    if (codigo === 'failed-precondition') {
      const motivo = MOTIVOS_CONFIG.find(m => m === mensaje);
      if (motivo) return new AnalyticsPanelError('Falta terminar la configuración de Analytics.', motivo);
      if (mensaje === 'cuota') return new AnalyticsPanelError('Google limitó las consultas por un rato. Probá en unos minutos.', 'cuota');
    }
    if (codigo === 'permission-denied') return new AnalyticsPanelError('No tenés permiso para ver Analytics.', 'permiso');
    if (codigo === 'unauthenticated') return new AnalyticsPanelError('Tu sesión venció. Volvé a iniciar sesión.', 'permiso');
    if (codigo === 'invalid-argument') return new AnalyticsPanelError(mensaje || 'Las fechas no son válidas.', 'otro');
    // La función todavía no está publicada (o no responde)
    if (codigo === 'not-found' || codigo === 'unavailable' || (codigo === 'internal' && /^internal$/i.test(mensaje.trim()))) {
      return new AnalyticsPanelError('El servicio de Analytics todavía no está publicado.', 'sin-funcion');
    }
    console.error('Error de Analytics', err);
    return new AnalyticsPanelError('No se pudieron traer los datos de Analytics. ' + mensaje, 'otro');
  }
}
