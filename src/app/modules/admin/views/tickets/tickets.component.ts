import { Component, Input, OnInit } from '@angular/core';
import { take } from 'rxjs/operators';
import Swal from 'sweetalert2';
import { TicketsService, TicketError } from 'src/app/modules/despacho/services/tickets.service';
import { SucursalesService } from '../../services/sucursales.service';
import { textoPagos, efectivoDeVenta } from 'src/app/modules/despacho/services/pagos';

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
export class TicketsComponent implements OnInit {

  /** true cuando se muestra dentro de la ventana de despacho */
  @Input() embebido = false;

  /** Sucursal con la que arranca filtrado (en despacho: la sucursal donde se está vendiendo) */
  @Input() sucursalInicial: string | null = null;

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

  cargando = false;
  busquedaPorNumero = false;
  error = '';

  constructor(public ticketsService: TicketsService, private sucursalesService: SucursalesService) { }

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

  aplicarFiltros() {
    const texto = this.filtroTexto.trim().toLowerCase();
    this.filtrados = this.tickets.filter(t =>
      (!this.filtroSucursal || t.sucursalId === this.filtroSucursal) &&
      (!this.filtroEstado || (this.filtroEstado === 'anulados' ? t.anulada === true : t.anulada !== true)) &&
      (!texto || [
        t.cliente?.nombre, t.cliente?.dni, t.usuario?.nombre, t.usuario?.usuario,
        this.ticketsService.numeroFormateado(t), t.nroTicket,
        t.orden?.numeroOrden, t.orden?.equipo, t.orden?.imei,
        ...(t.items || []).map((i: any) => i.nombre)
      ].some(v => String(v ?? '').toLowerCase().includes(texto)))
    );
  }

  limpiarFiltros() {
    this.filtroTexto = '';
    this.filtroSucursal = '';
    this.filtroEstado = '';
    this.aplicarFiltros();
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
             <br><small>${t.tipoVenta === 'reparacion'
               ? 'Es un cobro de reparación: se descuenta de la orden y el saldo vuelve a quedar pendiente.'
               : 'Se devuelve el stock, se revierten los puntos del cliente y el uso del cupón.'}<br>
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
      if (res.puntosRevertidos) avisos.push('✔ Puntos del cliente revertidos');
      if (res.cuponDevuelto) avisos.push('✔ Uso del cupón devuelto');
      if (res.ordenReparacion) avisos.push(`✔ Se descontó el cobro de la orden de reparación #${res.ordenReparacion} (el saldo vuelve a quedar pendiente)`);
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

      // Refrescamos el ticket en la lista
      t.anulada = true;
      t.motivoAnulacion = r.value;
      this.aplicarFiltros();
    } catch (err: any) {
      if (err instanceof TicketError) {
        Swal.fire('No se pudo anular', err.message, 'warning');
      } else {
        console.error('Error anulando ticket:', err);
        Swal.fire('Error', 'No se pudo anular el ticket. ' + (err?.message || ''), 'error');
      }
    }
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
