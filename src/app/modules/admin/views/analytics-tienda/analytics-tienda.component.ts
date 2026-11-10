import { Component, OnInit } from '@angular/core';
import Swal from 'sweetalert2';
import {
  AnalyticsPanelError, AnalyticsPanelService, MotivoConfiguracion, PanelAnalytics, TotalesAnalytics
} from '../../services/analytics-panel.service';

type Periodo = 'hoy' | '7d' | '30d' | 'mes' | 'mesAnterior' | 'custom';
type EstadoPaso = 'listo' | 'falta' | 'pendiente';

interface PasoConfiguracion {
  motivos: MotivoConfiguracion[];
  titulo: string;
  detalle: string;
  link?: { texto: string; url: string };
  codigo?: string;
}

/** Cuenta de servicio con la que la función lee Google Analytics (Cloud Functions 2ª gen.) */
const CUENTA_SERVICIO = '740660291155-compute@developer.gserviceaccount.com';

/**
 * Analytics de la tienda: lo que hacen los visitantes en la tienda online
 * (visitas, embudo de compra, productos, búsquedas y de dónde llegan).
 * Los datos vienen de Google Analytics a través de la función de Firebase "analyticsTienda".
 * Es otra cosa que el Dashboard (que muestra ventas, caja y taller del negocio).
 */
@Component({
  selector: 'app-analytics-tienda',
  templateUrl: './analytics-tienda.component.html',
  styleUrls: ['../tablero/tablero.component.css', './analytics-tienda.component.css']
})
export class AnalyticsTiendaComponent implements OnInit {

  readonly periodos: { valor: Periodo; nombre: string }[] = [
    { valor: 'hoy', nombre: 'Hoy' },
    { valor: '7d', nombre: '7 días' },
    { valor: '30d', nombre: '30 días' },
    { valor: 'mes', nombre: 'Este mes' },
    { valor: 'mesAnterior', nombre: 'Mes anterior' },
    { valor: 'custom', nombre: 'Elegir fechas' }
  ];

  readonly cuentaServicio = CUENTA_SERVICIO;

  /** Pasos para dejar Analytics funcionando (se marcan según lo que responde la función) */
  readonly pasos: PasoConfiguracion[] = [
    {
      motivos: ['sin-funcion'],
      titulo: 'Publicar el servicio de Analytics',
      detalle: 'En la carpeta del proyecto, instalar las dependencias de la función y publicarla.',
      codigo: 'cd functions\nnpm install\ncd ..\nfirebase deploy --only functions'
    },
    {
      motivos: ['sin-configurar', 'propiedad-incorrecta'],
      titulo: 'Cargar el ID de la propiedad de Google Analytics',
      detalle: 'En Google Analytics → Administrar → Detalles de la propiedad, copiar el "ID de propiedad" (solo números, no el G-…). ' +
        'Pegarlo en el archivo functions/configuracion.js (GA_PROPERTY_ID: \'…\') y volver a publicar la función.',
      link: { texto: 'Abrir Google Analytics', url: 'https://analytics.google.com/analytics/web/' },
      codigo: 'firebase deploy --only functions'
    },
    {
      motivos: ['api-desactivada'],
      titulo: 'Activar la API de datos de Google Analytics',
      detalle: 'En Google Cloud, con el proyecto storejcexclusivo, tocar "Habilitar" en "Google Analytics Data API".',
      link: { texto: 'Abrir la API en Google Cloud', url: 'https://console.cloud.google.com/apis/library/analyticsdata.googleapis.com?project=storejcexclusivo' }
    },
    {
      motivos: ['sin-permiso-ga'],
      titulo: 'Darle permiso de lectura a la función',
      detalle: 'En Google Analytics → Administrar → Gestión del acceso a la propiedad → "+" → Agregar usuarios: ' +
        'pegar el mail de abajo, elegir el rol "Lector" y desmarcar "Notificar por email".',
      link: { texto: 'Abrir Google Analytics', url: 'https://analytics.google.com/analytics/web/' },
      codigo: CUENTA_SERVICIO
    }
  ];

  periodo: Periodo = '7d';
  desde: Date = new Date();
  hasta: Date = new Date();

  cargando = false;
  datos: PanelAnalytics | null = null;
  error = '';
  motivo: AnalyticsPanelError['motivo'] | null = null;
  /** Mensaje original de Google, para saber exactamente qué falta */
  detalleError = '';

  // Gráfico de visitas
  verTabla = false;
  hover: PanelAnalytics['porDia'][number] | null = null;
  hoverIdx = 0;
  ejeMax = 1;
  ticks: number[] = [0];

  constructor(private analytics: AnalyticsPanelService) { }

  ngOnInit(): void {
    this.elegirPeriodo('7d');
  }

  // =====================================================
  // PERÍODO Y CARGA
  // =====================================================

  elegirPeriodo(p: Periodo) {
    this.periodo = p;
    if (p === 'custom') return;
    const hoy = new Date();
    let inicio = new Date(hoy), fin = new Date(hoy);
    switch (p) {
      case '7d': inicio.setDate(hoy.getDate() - 6); break;
      case '30d': inicio.setDate(hoy.getDate() - 29); break;
      case 'mes': inicio = new Date(hoy.getFullYear(), hoy.getMonth(), 1); break;
      case 'mesAnterior':
        inicio = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
        fin = new Date(hoy.getFullYear(), hoy.getMonth(), 0);
        break;
    }
    this.desde = inicio;
    this.hasta = fin;
    this.cargar();
  }

  aplicarFechas() {
    if (!this.desde || !this.hasta) return;
    if (this.desde > this.hasta) {
      Swal.fire('Fechas', 'La fecha "desde" tiene que ser anterior a "hasta".', 'warning');
      return;
    }
    if (this.hasta > new Date()) {
      Swal.fire('Fechas', 'La fecha "hasta" no puede ser posterior a hoy.', 'warning');
      return;
    }
    if ((this.hasta.getTime() - this.desde.getTime()) / 86400000 > 366) {
      Swal.fire('Fechas', 'Elegí un rango de hasta un año.', 'warning');
      return;
    }
    this.cargar();
  }

  async cargar(forzar = false) {
    this.cargando = true;
    this.error = '';
    this.motivo = null;
    this.detalleError = '';
    try {
      this.datos = await this.analytics.obtener(this.desde, this.hasta, forzar);
      this.hover = null;
      this.armarEje();
    } catch (err: any) {
      this.datos = null;
      this.motivo = err instanceof AnalyticsPanelError ? err.motivo : 'otro';
      this.error = err?.message || 'No se pudieron traer los datos.';
      this.detalleError = err instanceof AnalyticsPanelError ? err.detalle : '';
    } finally {
      this.cargando = false;
    }
  }

  get faltaConfigurar(): boolean {
    return this.pasos.some(p => this.motivo && p.motivos.includes(this.motivo as MotivoConfiguracion));
  }

  /** Los pasos anteriores al que falló ya están hechos; los siguientes, pendientes */
  estadoPaso(i: number): EstadoPaso {
    const fallo = this.pasos.findIndex(p => this.motivo && p.motivos.includes(this.motivo as MotivoConfiguracion));
    if (fallo < 0) return 'listo';
    return i < fallo ? 'listo' : i === fallo ? 'falta' : 'pendiente';
  }

  async copiar(texto: string) {
    try {
      await navigator.clipboard.writeText(texto);
      Swal.fire({ toast: true, position: 'top-end', timer: 1500, showConfirmButton: false, icon: 'success', title: 'Copiado' });
    } catch {
      Swal.fire('Copiar', texto, 'info');
    }
  }

  // =====================================================
  // INDICADORES
  // =====================================================

  get sinDatos(): boolean {
    const t = this.datos?.totales;
    return !!t && t.usuarios === 0 && t.vistas === 0;
  }

  /** Variación % contra el período anterior (null si no hay base para comparar) */
  variacion(campo: keyof TotalesAnalytics): number | null {
    const actual = this.datos?.totales?.[campo] ?? 0;
    const antes = this.datos?.anterior?.[campo] ?? 0;
    if (!antes) return null;
    return Math.round(((actual - antes) / antes) * 1000) / 10;
  }

  get porcentajeNuevos(): string {
    const t = this.datos?.totales;
    return t && t.usuarios ? Math.round((t.nuevos / t.usuarios) * 100) + '%' : '-';
  }

  get paginasPorSesion(): string {
    const t = this.datos?.totales;
    return t && t.sesiones ? (t.vistas / t.sesiones).toLocaleString('es-AR', { maximumFractionDigits: 1 }) : '-';
  }

  // ---------- Embudo ----------

  get baseEmbudo(): number {
    return Math.max(0, ...(this.datos?.embudo || []).map(p => p.usuarios));
  }

  anchoEmbudo(usuarios: number): number {
    const base = this.baseEmbudo;
    return base > 0 ? Math.max(usuarios > 0 ? 2 : 0, (usuarios / base) * 100) : 0;
  }

  /** De los que hicieron el paso anterior, qué % hizo este */
  pasoSiguiente(i: number): string {
    const e = this.datos?.embudo || [];
    if (i === 0 || !e[i - 1]?.usuarios) return '';
    return Math.round((e[i].usuarios / e[i - 1].usuarios) * 100) + '% del paso anterior';
  }

  get conversion(): string {
    const e = this.datos?.embudo || [];
    const vieron = e[0]?.usuarios || 0, compraron = e[e.length - 1]?.usuarios || 0;
    return vieron ? (Math.round((compraron / vieron) * 1000) / 10).toLocaleString('es-AR') + '%' : '-';
  }

  // ---------- Listas ----------

  ancho(valor: number, lista: any[], campo: string): number {
    const max = Math.max(0, ...lista.map(x => Number(x[campo]) || 0));
    return max > 0 ? Math.max(1, (valor / max) * 100) : 0;
  }

  porcentaje(valor: number, lista: any[], campo: string): string {
    const total = lista.reduce((a, x) => a + (Number(x[campo]) || 0), 0);
    return total > 0 ? Math.round((valor / total) * 100) + '%' : '-';
  }

  tasa(parte: number, total: number): string {
    return total > 0 ? Math.round((parte / total) * 100) + '%' : '-';
  }

  // =====================================================
  // GRÁFICO DE VISITAS
  // =====================================================

  private armarEje() {
    const max = Math.max(0, ...(this.datos?.porDia || []).map(b => b.usuarios));
    if (max <= 0) { this.ejeMax = 1; this.ticks = [0]; return; }
    const paso0 = Math.max(1, max / 4);
    const mag = Math.pow(10, Math.floor(Math.log10(paso0)));
    const paso = Math.max(1, [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= paso0) || paso0);
    this.ejeMax = paso * Math.ceil(max / paso);
    this.ticks = [];
    for (let v = 0; v <= this.ejeMax + 0.001; v += paso) this.ticks.push(Math.round(v));
  }

  alto(valor: number): number {
    return this.ejeMax > 0 ? (valor / this.ejeMax) * 100 : 0;
  }

  posTooltip(): { left: number; transform: string } {
    const n = this.datos?.porDia.length || 1;
    const left = ((this.hoverIdx + 0.5) / n) * 100;
    const transform = left < 20 ? 'translateX(8px)' : left > 80 ? 'translateX(calc(-100% - 8px))' : 'translateX(-50%)';
    return { left, transform };
  }

  /** Etiquetas del eje sin amontonar (menos en el celular) */
  mostrarEtiqueta(i: number): boolean {
    const n = this.datos?.porDia.length || 0;
    const max = typeof window !== 'undefined' && window.innerWidth < 600 ? 5 : 12;
    return i % Math.max(1, Math.ceil(n / max)) === 0;
  }

  // =====================================================
  // FORMATO
  // =====================================================

  get textoRango(): string {
    if (!this.datos) return '';
    const { desde, hasta } = this.datos.rango;
    return desde === hasta ? this.fecha(desde) : `${this.fecha(desde)} al ${this.fecha(hasta)}`;
  }

  /** "2026-11-04" → "04/11/2026" */
  fecha(iso: string): string {
    const [a, m, d] = iso.split('-');
    return `${d}/${m}/${a}`;
  }

  /** "2026-11-04" → "04/11" (eje del gráfico) */
  fechaCorta(iso: string): string {
    const [, m, d] = iso.split('-');
    return `${d}/${m}`;
  }

  numero(n: number): string {
    return new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(Number(n) || 0);
  }

  moneda(n: number): string {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(Number(n) || 0);
  }

  porciento(n: number): string {
    return Math.round((Number(n) || 0) * 100) + '%';
  }

  /** 95 → "1 min 35 s" */
  duracion(segundos: number): string {
    const s = Math.round(Number(segundos) || 0);
    if (s < 60) return `${s} s`;
    const m = Math.floor(s / 60);
    return `${m} min${s % 60 ? ' ' + (s % 60) + ' s' : ''}`;
  }
}
