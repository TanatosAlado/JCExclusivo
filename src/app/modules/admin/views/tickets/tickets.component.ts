import { AfterViewInit, Component, ElementRef, Input, NgZone, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { take } from 'rxjs/operators';
import { PageEvent } from '@angular/material/paginator';
import Swal from 'sweetalert2';
import { TicketsService, TicketError } from 'src/app/modules/despacho/services/tickets.service';
import { SucursalesService } from '../../services/sucursales.service';
import { textoPagos, efectivoDeVenta, aCuentaDeVenta } from 'src/app/modules/despacho/services/pagos';
import { textoOrdenes } from 'src/app/modules/despacho/services/desglose-reparacion';
import {
  METODOS_DEVOLUCION, RenglonDevolvible, devolucionesVigentes, importeDevolucion, motivoSinDevolucion,
  renglonesDevolvibles, repartoDevolucion, totalDevuelto, validarSeleccion
} from 'src/app/modules/despacho/services/devoluciones';
import { CajerosService, Cajero, cajeroParaVenta, nombreCajero } from '../../services/cajeros.service';
import { nombreMetodo } from 'src/app/modules/despacho/services/pagos';

/**
 * Tickets de venta del local: búsqueda por número, fecha y cliente,
 * vista previa / reimpresión y anulación.
 *
 * Se usa en dos lugares:
 *  - Gestiones → Tickets (pantalla completa).
 *  - Despacho, dentro de una ventana (embebido = true), sin encabezado ni navegación.
 */
@Component({
  selector: 'app-tickets',
  templateUrl: './tickets.component.html',
  styleUrls: ['./tickets.component.css']
})
export class TicketsComponent implements OnInit, AfterViewInit, OnDestroy {

  /** true cuando se muestra dentro de la ventana de despacho */
  @Input() embebido = false;

  /** Sucursal con la que arranca filtrado (en despacho: la sucursal donde se está vendiendo) */
  @Input() sucursalInicial: string | null = null;

  /** Caja abierta de Despacho (si se usa ahí): las devoluciones de plata salen de esta caja */
  @Input() caja: any = null;

  // ↩ Devolución parcial de productos
  devVenta: any = null;
  devRenglones: (RenglonDevolvible & { cantidad: number })[] = [];
  devImporte: number | null = null;
  devImporteEditado = false;
  devMetodo: string | null = null;
  devMotivo = '';
  devCajeroId: string | null = null;
  devCajeros: Cajero[] = [];
  devCaja: any = null;
  devPendienteCuenta = 0;
  devCargando = false;
  devProcesando = false;
  devError = '';
  readonly metodosDevolucion = METODOS_DEVOLUCION;
  readonly nombreMetodo = nombreMetodo;
  readonly motivoSinDevolucion = motivoSinDevolucion;
  readonly totalDevuelto = totalDevuelto;
  private ultimaConsulta: { consulta: () => Promise<any[]>; porNumero: boolean } | null = null;

  desde: Date = this.haceDias(6);
  hasta: Date = new Date();
  numeroBuscado: number | null = null;

  filtroTexto = '';
  filtroSucursal = '';
  filtroEstado: '' | 'vigentes' | 'anulados' = '';

  tickets: any[] = [];
  filtrados: any[] = [];
  nombresSucursales: { [id: string]: string } = {};
  sucursales: { id: string; nombre: string }[] = [];

  /** Por debajo de este ancho (el de la tabla, no el de la pantalla) cada ticket se ve como tarjeta */
  static readonly ANCHO_TARJETAS = 1100;
  @ViewChild('contenedorTabla') contenedorTabla?: ElementRef<HTMLElement>;
  modoTarjetas = false;
  private observador: ResizeObserver | null = null;

  // 📄 Paginado (la búsqueda trae todo el rango de fechas; se muestra de a una página)
  pagina = 0;
  porPagina = 25;
  readonly opcionesPorPagina = [10, 25, 50, 100];

  readonly textoOrdenes = textoOrdenes;

  cargando = false;
  busquedaPorNumero = false;
  error = '';

  constructor(
    public ticketsService: TicketsService,
    private sucursalesService: SucursalesService,
    private zona: NgZone,
    private cajerosService: CajerosService
  ) { }

  ngAfterViewInit(): void {
    const el = this.contenedorTabla?.nativeElement;
    if (!el) return;
    const medir = (ancho: number) => {
      const tarjetas = ancho > 0 && ancho < TicketsComponent.ANCHO_TARJETAS;
      if (tarjetas !== this.modoTarjetas) this.zona.run(() => this.modoTarjetas = tarjetas);
    };
    if (typeof ResizeObserver !== 'undefined') {
      this.observador = new ResizeObserver(entradas => medir(entradas[0]?.contentRect.width || 0));
      this.observador.observe(el);
    }
    setTimeout(() => medir(el.clientWidth));
  }

  ngOnDestroy(): void {
    this.observador?.disconnect();
  }

  ngOnInit(): void {
    this.sucursalesService.obtenerSucursales().pipe(take(1)).subscribe(sucs => {
      this.sucursales = (sucs || []).filter(s => s.id).map(s => ({ id: s.id as string, nombre: s.nombre }));
      this.sucursales.forEach(s => this.nombresSucursales[s.id] = s.nombre);
      if (this.sucursalInicial) this.filtroSucursal = this.sucursalInicial;
      this.buscarPorFecha();
    });
  }

  async buscarPorFecha() {
    const inicio = new Date(this.desde); inicio.setHours(0, 0, 0, 0);
    const fin = new Date(this.hasta); fin.setHours(23, 59, 59, 999);
    if (inicio > fin) {
      this.error = 'La fecha "desde" no puede ser posterior a "hasta".';
      return;
    }
    await this.ejecutar(() => this.ticketsService.buscarEntreFechas(inicio, fin), false);
  }

  async buscarPorNumero() {
    const nro = Math.floor(Number(this.numeroBuscado));
    if (!nro || nro < 1) {
      this.error = 'Ingresá un número de ticket válido.';
      return;
    }
    await this.ejecutar(() => this.ticketsService.buscarPorNumero(nro), true);
  }

  private async ejecutar(consulta: () => Promise<any[]>, porNumero: boolean) {
    this.ultimaConsulta = { consulta, porNumero };
    this.cargando = true;
    this.error = '';
    try {
      this.tickets = await consulta();
      this.busquedaPorNumero = porNumero;
      this.aplicarFiltros();
      if (porNumero && !this.tickets.length) {
        this.error = `No existe el ticket Nº ${this.numeroBuscado}.`;
      }
    } catch (err: any) {
      console.error('Error buscando tickets:', err);
      this.error = 'No se pudieron buscar los tickets. ' + (err?.message || '');
      this.tickets = [];
      this.filtrados = [];
    } finally {
      this.cargando = false;
    }
  }

  /** Tickets de la página que se está viendo */
  get paginaActual(): any[] {
    const desde = this.pagina * this.porPagina;
    return this.filtrados.slice(desde, desde + this.porPagina);
  }

  cambiarPagina(e: PageEvent) {
    this.pagina = e.pageIndex;
    this.porPagina = e.pageSize;
  }

  aplicarFiltros() {
    this.pagina = 0;
    const texto = this.filtroTexto.trim().toLowerCase();
    this.filtrados = this.tickets.filter(t =>
      (!this.filtroSucursal || t.sucursalId === this.filtroSucursal) &&
      (!this.filtroEstado || (this.filtroEstado === 'anulados' ? t.anulada === true : t.anulada !== true)) &&
      (!texto || [
        t.cliente?.nombre, t.cliente?.dni, t.usuario?.nombre, t.usuario?.usuario,
        t.cajero?.nombre, t.cajero?.apellido,
        this.ticketsService.numeroFormateado(t), t.nroTicket,
        t.orden?.numeroOrden, t.orden?.equipo, t.orden?.imei,
        ...(t.ordenes || []).flatMap((o: any) => [o.numeroOrden, o.equipo, o.imei]),
        ...(t.items || []).map((i: any) => i.nombre),
        ...(t.pagos || []).map((p: any) => p.detalle)   // nº de operación del posnet
      ].some(v => String(v ?? '').toLowerCase().includes(texto)))
    );
  }

  limpiarFiltros() {
    this.filtroTexto = '';
    this.filtroSucursal = '';
    this.filtroEstado = '';
    this.aplicarFiltros();
  }

  /** Vuelve a hacer la última búsqueda (después de anular o devolver), sin perder los filtros ni la página */
  private async recargar() {
    if (!this.ultimaConsulta) return;
    const pagina = this.pagina;
    try {
      this.tickets = await this.ultimaConsulta.consulta();
      this.aplicarFiltros();
      this.pagina = Math.min(pagina, Math.max(0, Math.ceil(this.filtrados.length / this.porPagina) - 1));
    } catch (e) {
      console.error('Error recargando tickets', e);
    }
  }

  get totalVigente(): number {
    return this.filtrados.filter(t => t.anulada !== true).reduce((a, t) => a + (Number(t.total) || 0), 0);
  }

  get cantidadAnulados(): number {
    return this.filtrados.filter(t => t.anulada === true).length;
  }

  ver(t: any) {
    this.ticketsService.abrir(t, 'vista');
  }

  imprimir(t: any) {
    this.ticketsService.abrir(t, 'imprimir');
  }

  /** "Efectivo" o "Efectivo $54.000 + Tarjeta $40.000" */
  pagos(t: any): string {
    return textoPagos(t, n => this.moneda(n));
  }

  async anular(t: any) {
    if (t.anulada) return;

    const r = await Swal.fire({
      title: `¿Anular el ticket Nº ${this.ticketsService.numeroFormateado(t)}?`,
      html: `Total: <strong>${this.moneda(t.total)}</strong> (${this.pagos(t)})<br>
             ${t.cliente ? `Cliente: ${t.cliente.nombre}<br>` : ''}
             <br><small>${t.tipoVenta === 'refinanciacion'
               ? 'Es una refinanciación: el crédito nuevo se anula (si no tiene cuotas pagadas) y el anterior vuelve a quedar vigente con sus cuotas.' +
                 (Number(t.total) > 0 ? ' La entrega no vuelve sola a la caja.' : '')
               : t.tipoVenta === 'devolucion'
               ? 'Es una nota de devolución: los productos vuelven a salir del stock, la devolución se saca del ticket original y, si se descontó de la cuenta corriente, la deuda vuelve. La plata que se le devolvió al cliente no vuelve sola a la caja.'
               : t.tipoVenta === 'reparacion'
               ? 'Es un cobro de reparación: se descuenta de la orden y el saldo vuelve a quedar pendiente.'
               : t.tipoVenta === 'cobrocuenta'
                 ? 'Es un cobro de cuenta corriente: la deuda que pagó vuelve a quedar pendiente en la cuenta del cliente.'
               : t.tipoVenta === 'cobrocuota'
                 ? 'Es un cobro de cuotas del crédito de la casa: las cuotas que pagó vuelven a quedar pendientes.'
                 : 'Se devuelve el stock, se revierten los puntos del cliente y el uso del cupón.' +
                   ((t.items || []).some((i: any) => i.tipo === 'equipo') ? ' Los equipos vuelven a estar a la venta.' : '') +
                   (aCuentaDeVenta(t) > 0 ? ` Se descuentan ${this.moneda(aCuentaDeVenta(t))} de la cuenta corriente del cliente.` : '')}<br>
             El ticket no se borra: queda registrado como ANULADO.</small>`,
      icon: 'warning',
      input: 'text',
      inputLabel: 'Motivo de la anulación',
      inputPlaceholder: 'Ej: devolución del producto',
      inputValidator: (v: string) => (!v || v.trim().length < 3) ? 'Ingresá un motivo' : null,
      showCancelButton: true,
      confirmButtonText: 'Anular ticket',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#d33'
    });
    if (!r.isConfirmed) return;

    try {
      const res = await this.ticketsService.anular(t, r.value);

      const avisos: string[] = [];
      if (res.stockDevuelto.length) avisos.push(`✔ Stock devuelto: ${res.stockDevuelto.join(', ')}`);
      if (res.stockNoDevuelto.length) avisos.push(`⚠ No se devolvió stock (el producto ya no existe): ${res.stockNoDevuelto.join(', ')}`);
      if (res.equiposDevueltos?.length) avisos.push(`✔ Volvieron a estar a la venta: ${res.equiposDevueltos.join(', ')}`);
      if (res.puntosRevertidos) avisos.push('✔ Puntos del cliente revertidos');
      if (res.cuponDevuelto) avisos.push('✔ Uso del cupón devuelto');
      if (res.cuentaCorriente?.tipo === 'cargo') {
        avisos.push(`✔ Se descontaron ${this.moneda(res.cuentaCorriente.importe)} de la cuenta corriente de ${res.cuentaCorriente.cliente}`);
      }
      if (res.cuentaCorriente?.tipo === 'pago') {
        avisos.push(`✔ La deuda de ${res.cuentaCorriente.cliente} volvió a aumentar ${this.moneda(res.cuentaCorriente.importe)} (el cobro quedó sin efecto)`);
      }
      if (res.creditoAnulado) avisos.push('✔ El crédito de la casa de este ticket quedó anulado');
      if (res.canjeDevuelto) avisos.push(`✔ El equipo del plan canje (${res.canjeDevuelto}) se dio de baja: hay que devolvérselo al cliente`);
      if (res.refinanciacionDeshecha) avisos.push('✔ La refinanciación se deshizo: el crédito anterior volvió a quedar vigente');
      if (res.cuotasRevertidas) avisos.push(`✔ Las cuotas ${res.cuotasRevertidas} del crédito de ${t.cliente?.nombre || 'el cliente'} volvieron a quedar pendientes`);
      if (res.ordenReparacion) avisos.push(`✔ Se descontó el cobro de ${String(res.ordenReparacion).includes(',') ? 'las órdenes' : 'la orden'} de reparación #${res.ordenReparacion} (el saldo vuelve a quedar pendiente)`);
      const efectivo = efectivoDeVenta(t);
      if (res.cajaCerrada && efectivo > 0) {
        avisos.push(`⚠ La caja de este ticket ya está cerrada. Si devolviste el efectivo (${this.moneda(efectivo)}), registralo como ` +
          '<strong>retiro</strong> en la caja abierta (Despacho → Movimientos).');
      }

      await Swal.fire({
        title: 'Ticket anulado',
        html: `<div style="text-align:left">${avisos.join('<br>')}</div>`,
        icon: 'success'
      });

      // Refrescamos el ticket en la lista (y el original, si era una devolución)
      t.anulada = true;
      t.motivoAnulacion = r.value;
      this.aplicarFiltros();
      if (t.tipoVenta === 'devolucion') await this.recargar();
    } catch (err: any) {
      if (err instanceof TicketError) {
        Swal.fire('No se pudo anular', err.message, 'warning');
      } else {
        console.error('Error anulando ticket:', err);
        Swal.fire('Error', 'No se pudo anular el ticket. ' + (err?.message || ''), 'error');
      }
    }
  }

  // =====================================================
  // ↩ DEVOLUCIÓN PARCIAL
  // =====================================================

  puedeDevolver(t: any): boolean {
    return !motivoSinDevolucion(t);
  }

  async abrirDevolucion(t: any) {
    const motivo = motivoSinDevolucion(t);
    if (motivo) { Swal.fire('No se puede devolver', motivo, 'info'); return; }
    this.devVenta = t;
    this.devRenglones = renglonesDevolvibles(t).map(r => ({ ...r, cantidad: 0 }));
    this.devImporte = null;
    this.devImporteEditado = false;
    this.devMetodo = null;
    this.devMotivo = '';
    this.devError = '';
    this.devCajeroId = null;
    this.devCaja = null;
    this.devPendienteCuenta = 0;
    this.devCargando = true;
    try {
      const [pendiente, caja, cajeros] = await Promise.all([
        this.ticketsService.pendienteCuentaDe(t).catch(() => 0),
        this.caja?.id ? Promise.resolve(this.caja) : this.ticketsService.cajaAbiertaDe(t.sucursalId).catch(() => null),
        this.cajerosService.listarActivos().catch(() => [] as Cajero[])
      ]);
      if (this.devVenta !== t) return;
      this.devPendienteCuenta = pendiente;
      this.devCaja = caja;
      this.devCajeros = cajeros;
    } finally {
      this.devCargando = false;
    }
  }

  cerrarDevolucion() {
    if (this.devProcesando) return;
    this.devVenta = null;
  }

  /** Cambió una cantidad: el importe vuelve a ser el sugerido (salvo que lo hayan escrito a mano) */
  cambioCantidad(r: RenglonDevolvible & { cantidad: number }, valor: any) {
    const n = Math.floor(Number(valor) || 0);
    r.cantidad = Math.max(0, Math.min(r.disponible, n));
    if (!this.devImporteEditado) this.devImporte = this.devSugerido || null;
    this.devError = '';
  }

  todo(r: RenglonDevolvible & { cantidad: number }) {
    this.cambioCantidad(r, r.disponible);
  }

  cambioImporte(v: any) {
    this.devImporte = v === null || v === '' ? null : Number(v);
    this.devImporteEditado = true;
    this.devError = '';
  }

  usarSugerido() {
    this.devImporteEditado = false;
    this.devImporte = this.devSugerido || null;
  }

  private get devSeleccion() {
    return this.devRenglones.filter(r => r.cantidad > 0).map(r => ({ indice: r.indice, cantidad: r.cantidad }));
  }

  /** Lo que pagó por lo elegido (con los descuentos del ticket) */
  get devSugerido(): number {
    return this.devVenta ? importeDevolucion(this.devVenta, this.devSeleccion) : 0;
  }

  /** Cuánto se descuenta de la cuenta corriente y cuánta plata se devuelve */
  get devReparto(): { aCuenta: number; dinero: number } {
    return this.devVenta ? repartoDevolucion(this.devVenta, Number(this.devImporte) || 0, this.devPendienteCuenta) : { aCuenta: 0, dinero: 0 };
  }

  get devErrorValidacion(): string | null {
    if (!this.devVenta) return null;
    if (!this.devSeleccion.length) return 'Elegí qué productos devuelve.';
    const v = validarSeleccion(this.devVenta, this.devSeleccion);
    if (v.error) return v.error;
    const imp = Number(this.devImporte) || 0;
    if (!(imp > 0)) return 'Ingresá el importe a devolver.';
    if (imp > this.devSugerido + 0.009) return `No puede ser más de lo que pagó por esos productos (${this.moneda(this.devSugerido)}).`;
    if (this.devReparto.dinero > 0 && !this.devMetodo) return 'Elegí con qué medio le devolvés la plata.';
    if (this.devReparto.dinero > 0 && !this.devCaja) return 'Para devolver plata tiene que haber una caja abierta en la sucursal del ticket.';
    if (this.devMotivo.trim().length < 3) return 'Ingresá el motivo de la devolución.';
    return null;
  }

  async confirmarDevolucion() {
    const t = this.devVenta;
    if (!t || this.devProcesando || this.devErrorValidacion) return;
    const rep = this.devReparto;
    const cajero = this.devCajeros.find(c => c.id === this.devCajeroId) || null;
    const lista = this.devRenglones.filter(r => r.cantidad > 0).map(r => `${r.cantidad} × ${this.esc(r.nombre)}`).join('<br>');
    const ok = await Swal.fire({
      title: '¿Registrar la devolución?',
      html: `<div style="text-align:left">Ticket Nº ${this.ticketsService.numeroFormateado(t)}<br><small>${lista}</small><br><br>
        ${rep.aCuenta > 0 ? `Se descuentan <strong>${this.moneda(rep.aCuenta)}</strong> de la cuenta corriente.<br>` : ''}
        ${rep.dinero > 0 ? `Se le devuelven <strong>${this.moneda(rep.dinero)}</strong> en ${this.esc(nombreMetodo(this.devMetodo).toLowerCase())}.<br>` : ''}
        <small>Los productos vuelven al stock.</small></div>`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Registrar devolución',
      cancelButtonText: 'Volver'
    });
    if (!ok.isConfirmed) return;
    this.devProcesando = true;
    this.devError = '';
    try {
      const res = await this.ticketsService.devolver(t, this.devSeleccion,
        { importe: Number(this.devImporte), metodo: this.devMetodo, motivo: this.devMotivo, cajero: cajero ? cajeroParaVenta(cajero) : null },
        this.devCaja);
      this.devProcesando = false;
      this.devVenta = null;
      await this.recargar();
      const fin = await Swal.fire({
        title: `↩ Devolución registrada · Nota Nº ${this.ticketsService.numeroFormateado(res.nota)}`,
        html: `<div style="text-align:left">` +
          (res.stockDevuelto.length ? `✔ Volvieron al stock: ${res.stockDevuelto.map(n => this.esc(n)).join(', ')}<br>` : '') +
          (res.aCuenta > 0 ? `✔ Se descontaron ${this.moneda(res.aCuenta)} de la cuenta corriente<br>` : '') +
          (res.dinero > 0 ? `✔ Devolvele al cliente <strong>${this.moneda(res.dinero)}</strong> en ${this.esc(nombreMetodo(this.devMetodo).toLowerCase())}` : '') +
          `</div>`,
        icon: 'success',
        showCancelButton: true,
        showDenyButton: true,
        confirmButtonText: '🖨 Imprimir nota',
        denyButtonText: 'Ver nota',
        cancelButtonText: 'Cerrar'
      });
      if (fin.isConfirmed) this.ticketsService.abrir(res.nota, 'imprimir');
      else if (fin.isDenied) this.ticketsService.abrir(res.nota, 'vista');
    } catch (err: any) {
      this.devError = err instanceof TicketError ? err.message : 'No se pudo registrar la devolución. ' + (err?.message || '');
      if (!(err instanceof TicketError)) console.error('Error registrando devolución', err);
    } finally {
      this.devProcesando = false;
    }
  }

  nombreCajero(c: Cajero): string {
    return nombreCajero(c);
  }

  devueltas(t: any): number {
    return devolucionesVigentes(t).length;
  }

  private esc(t: any): string {
    return String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  private moneda(n: any): string {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(Number(n) || 0);
  }

  private haceDias(dias: number): Date {
    const d = new Date();
    d.setDate(d.getDate() - dias);
    return d;
  }
}
