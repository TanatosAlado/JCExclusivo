import { Injectable, NgZone } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { environment } from 'src/environment/environment';
import { filter } from 'rxjs/operators';
import { AuthService } from 'src/app/modules/auth/services/auth.service';
import { debeMedir, ItemAnalytics, rutaParaInforme, terminoBusqueda, valorItems } from '../utils/analytics-tienda';

/**
 * Google Analytics (GA4) de la tienda, con la etiqueta oficial de Google (gtag.js) y el
 * ID de medición de environment.firebase.measurementId.
 * (No se usa la librería de Analytics de Firebase: le pide el ID al servidor de Firebase y,
 *  mientras la vinculación con Analytics no está activa del lado de Google, arranca sin ID y no mide nada.)
 *
 *  - Se mide solo la tienda: Gestiones, Despacho, los administradores logueados y localhost no se miden
 *    (se apaga la recolección, así tampoco se mandan los eventos automáticos de Google).
 *  - Las páginas vistas se mandan a mano en cada navegación (es una app de una sola página).
 *  - Si Analytics no está disponible (bloqueador de anuncios, navegador viejo, sin configurar),
 *    no pasa nada: la tienda funciona igual y los eventos se ignoran.
 *
 * Eventos (nombres recomendados de GA4, así salen solos en los informes de comercio electrónico):
 *  page_view, view_item, add_to_cart, begin_checkout, purchase, search, login, sign_up
 */
@Injectable({ providedIn: 'root' })
export class AnalyticsService {

  private analytics: ((...args: any[]) => void) | null = null;   // gtag
  private idMedicion = '';
  private iniciado = false;
  private habilitado = false;
  private esAdmin = false;
  private urlActual = '/';
  private pendientes: { nombre: string; params: any }[] = [];
  private temporizadorBusqueda: any = null;
  private ultimaBusqueda = '';
  private ultimaPagina = { url: '', t: 0 };

  constructor(
    private router: Router,
    private authService: AuthService,
    private zone: NgZone
  ) { }

  /** Se llama una sola vez, al arrancar la app */
  iniciar(): void {
    if (this.iniciado || typeof window === 'undefined') return;
    this.iniciado = true;

    this.urlActual = this.router.url || window.location.pathname;
    this.esAdmin = this.authService.getClienteActualValor()?.administrador === true;

    this.zone.runOutsideAngular(() => this.cargar());   // sincrónico: no hace falta esperar nada

    this.router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe((e: any) => {
      this.urlActual = e.urlAfterRedirects || e.url;
      this.actualizarRecoleccion();
      this.paginaVista();
    });

    this.authService.getUsuarioActual().subscribe(c => {
      const admin = c?.administrador === true;
      if (admin === this.esAdmin) return;
      this.esAdmin = admin;
      this.actualizarRecoleccion();
    });
  }

  private cargar() {
    try {
      const id = String((environment as any)?.firebase?.measurementId || '').trim();
      if (!/^G-[A-Z0-9]+$/i.test(id)) return;   // sin ID configurado: no se mide
      this.idMedicion = id;

      const w: any = window;
      w.dataLayer = w.dataLayer || [];
      // eslint-disable-next-line prefer-rest-params
      w.gtag = w.gtag || function () { w.dataLayer.push(arguments); };
      this.analytics = w.gtag;

      // Primero se decide si se mide (así Google no manda nada desde Gestiones/Despacho ni de los admins)
      this.actualizarRecoleccion(true);
      this.analytics!('js', new Date());
      // Sin página vista automática: la mandamos nosotros (y solo en la tienda)
      this.analytics!('config', id, { send_page_view: false });

      const script = document.createElement('script');
      script.async = true;
      script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
      script.onerror = () => console.warn('Analytics no disponible (bloqueado por el navegador o sin conexión).');
      document.head.appendChild(script);

      this.paginaVista();
      const cola = this.pendientes;
      this.pendientes = [];
      cola.forEach(ev => this.enviar(ev.nombre, ev.params));
    } catch (err) {
      console.warn('Analytics no disponible:', err);
      this.pendientes = [];
    }
  }

  private get debe(): boolean {
    return debeMedir({ url: this.urlActual, esAdmin: this.esAdmin, host: window.location.hostname });
  }

  private actualizarRecoleccion(forzar = false) {
    const habilitar = this.debe;
    if (!this.analytics || (!forzar && habilitar === this.habilitado)) return;
    this.habilitado = habilitar;
    // Interruptor oficial de Google: con window['ga-disable-<ID>'] = true no se envía nada
    try { (window as any)['ga-disable-' + this.idMedicion] = !habilitar; } catch { }
  }

  private paginaVista() {
    if (!this.analytics || !this.debe) return;
    // La primera página puede llegar dos veces (al cargar Analytics y al terminar la navegación)
    const ahora = Date.now();
    if (this.ultimaPagina.url === this.urlActual && ahora - this.ultimaPagina.t < 2000) return;
    this.ultimaPagina = { url: this.urlActual, t: ahora };
    // Google arma la "ruta de la página" con page_location: va agrupada (los /producto/<id> cuentan juntos)
    const ruta = rutaParaInforme(this.urlActual);
    this.enviar('page_view', {
      page_path: ruta,
      page_location: window.location.origin + ruta,
      page_title: document.title
    });
  }

  private enviar(nombre: string, params: any) {
    if (!this.analytics) {
      if (this.iniciado && this.pendientes.length < 20) this.pendientes.push({ nombre, params });
      return;
    }
    if (!this.debe) return;
    try {
      this.zone.runOutsideAngular(() => this.analytics!('event', nombre, params));
    } catch (err) {
      console.warn('No se pudo registrar el evento', nombre, err);
    }
  }

  // =====================================================
  // EVENTOS DE LA TIENDA
  // =====================================================

  /** Vio el detalle de un producto (o la galería de un equipo) */
  verProducto(item: ItemAnalytics) {
    this.enviar('view_item', { currency: 'ARS', value: valorItems([item]), items: [item] });
  }

  agregarAlCarrito(item: ItemAnalytics) {
    this.enviar('add_to_cart', { currency: 'ARS', value: valorItems([item]), items: [item] });
  }

  iniciarCompra(items: ItemAnalytics[], valor?: number) {
    if (!items?.length) return;
    this.enviar('begin_checkout', { currency: 'ARS', value: valor ?? valorItems(items), items });
  }

  /** Pedido web confirmado */
  compra(datos: { nroPedido: number | string; valor: number; items: ItemAnalytics[]; cupon?: string | null; envio?: string }) {
    const params: any = {
      transaction_id: String(datos.nroPedido),
      currency: 'ARS',
      value: Math.round((Number(datos.valor) || 0) * 100) / 100,
      items: datos.items || []
    };
    if (datos.cupon) params.coupon = datos.cupon;
    if (datos.envio) params.shipping_tier = datos.envio;
    this.enviar('purchase', params);
  }

  /** Búsqueda en la grilla: se registra cuando deja de escribir (no letra por letra) */
  buscar(texto: any) {
    clearTimeout(this.temporizadorBusqueda);
    const termino = terminoBusqueda(texto);
    if (!termino) return;
    this.temporizadorBusqueda = setTimeout(() => {
      if (termino === this.ultimaBusqueda) return;
      this.ultimaBusqueda = termino;
      this.enviar('search', { search_term: termino });
    }, 1500);
  }

  login(tipo: 'cuenta' | 'invitado') {
    this.enviar('login', { method: tipo });
  }

  registro() {
    this.enviar('sign_up', { method: 'cuenta' });
  }
}
