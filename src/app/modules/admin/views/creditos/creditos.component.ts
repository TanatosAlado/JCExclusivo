import { Component, OnInit } from '@angular/core';
import * as XLSX from 'xlsx';
import Swal from 'sweetalert2';
import { Credito, CreditosService, PagoCredito } from 'src/app/modules/despacho/services/creditos.service';
import {
  CuotaCredito, ResumenCartera, SituacionCredito, estadoCuota, faltaCuota, resumenCartera, situacionCredito, textoVencimiento
} from 'src/app/modules/despacho/services/credito-casa';
import { TicketsService, TicketError } from 'src/app/modules/despacho/services/tickets.service';
import { textoPagos, efectivoDeVenta } from 'src/app/modules/despacho/services/pagos';
import { BuscadorClientesService } from 'src/app/shared/services/buscador-clientes.service';
import { SucursalesService } from '../../services/sucursales.service';
import { take } from 'rxjs/operators';

type FiltroEstado = 'vencidos' | 'vigentes' | 'al-dia' | 'cancelados' | 'anulados' | 'todos';

/** Crédito con su situación calculada (para la lista) */
interface FilaCredito {
  c: Credito;
  s: SituacionCredito;
  estado: 'vencido' | 'por-vencer' | 'al-dia' | 'cancelado' | 'anulado';
}

/**
 * Gestiones → Créditos de la casa (consulta y anulación).
 * Lista de créditos con el estado de sus cuotas (en tiempo o vencidas), detalle de cada uno,
 * pagos con sus comprobantes y Excel. Las ventas y los cobros se hacen en Despacho.
 */
@Component({
  selector: 'app-creditos',
  templateUrl: './creditos.component.html',
  styleUrls: ['./creditos.component.css']
})
export class CreditosComponent implements OnInit {

  cargando = false;
  error = '';
  filas: FilaCredito[] = [];
  cartera: ResumenCartera | null = null;
  filtro = '';
  filtroEstado: FiltroEstado = 'vigentes';
  orden: 'atraso' | 'saldo' | 'reciente' | 'nombre' = 'atraso';
  nombresSucursales: { [id: string]: string } = {};

  // Detalle
  credito: Credito | null = null;
  pagos: PagoCredito[] = [];
  cargandoDetalle = false;
  verAnulados = false;
  anulando = false;

  readonly filtrosEstado: { valor: FiltroEstado; nombre: string }[] = [
    { valor: 'vencidos', nombre: '🔴 Con cuotas vencidas' },
    { valor: 'vigentes', nombre: 'Vigentes' },
    { valor: 'al-dia', nombre: '🟢 Al día' },
    { valor: 'cancelados', nombre: '✅ Terminados' },
    { valor: 'anulados', nombre: 'Anulados' },
    { valor: 'todos', nombre: 'Todos' }
  ];
  readonly estadoCuota = estadoCuota;
  readonly faltaCuota = faltaCuota;
  readonly textoVencimiento = textoVencimiento;

  constructor(
    private creditos: CreditosService,
    private tickets: TicketsService,
    private sucursalesService: SucursalesService
  ) { }

  ngOnInit() {
    this.sucursalesService.obtenerSucursales().pipe(take(1)).subscribe(lista => {
      (lista || []).forEach((s: any) => this.nombresSucursales[s.id] = s.nombre || s.id);
    });
    this.cargar();
  }

  async cargar() {
    this.cargando = true;
    this.error = '';
    try {
      const lista = await this.creditos.todos();
      const hoy = new Date();
      this.cartera = resumenCartera(lista, hoy);
      this.filas = lista.map(c => {
        const s = situacionCredito(c, hoy);
        const estado: FilaCredito['estado'] = c.estado === 'anulado' ? 'anulado'
          : (c.estado === 'cancelado' || s.estado === 'cancelado') ? 'cancelado' : s.estado as any;
        return { c, s, estado };
      });
      if (this.credito) {
        const actual = this.filas.find(f => f.c.id === this.credito!.id);
        if (actual) await this.abrir(actual.c);
      }
    } catch (e: any) {
      console.error('Error cargando créditos', e);
      this.error = 'No se pudieron cargar los créditos. ' + (e?.message || '');
    } finally {
      this.cargando = false;
    }
  }

  // =====================================================
  // LISTADO
  // =====================================================

  cantidad(f: FiltroEstado): number {
    return this.filas.filter(x => this.pasaEstado(x, f)).length;
  }

  private pasaEstado(x: FilaCredito, f: FiltroEstado): boolean {
    switch (f) {
      case 'vencidos': return x.estado === 'vencido';
      case 'vigentes': return x.estado === 'vencido' || x.estado === 'por-vencer' || x.estado === 'al-dia';
      case 'al-dia': return x.estado === 'por-vencer' || x.estado === 'al-dia';
      case 'cancelados': return x.estado === 'cancelado';
      case 'anulados': return x.estado === 'anulado';
      default: return true;
    }
  }

  get visibles(): FilaCredito[] {
    const palabras = BuscadorClientesService.normalizar(this.filtro).split(' ').filter(Boolean);
    const lista = this.filas
      .filter(x => this.pasaEstado(x, this.filtroEstado))
      .filter(x => {
        if (!palabras.length) return true;
        const c = x.c;
        const texto = BuscadorClientesService.normalizar(
          `${c.cliente?.nombre} ${c.cliente?.dni ?? ''} ${c.cliente?.telefono ?? ''} ${c.detalle ?? ''} ` +
          `${(c.equipos || []).map(e => `${e.nombre} ${e.imei}`).join(' ')} ${c.nroTicket ?? ''}`);
        return palabras.every(p => texto.includes(p));
      });
    const nombre = (x: FilaCredito) => String(x.c.cliente?.nombre || '');
    const rango = { vencido: 0, 'por-vencer': 1, 'al-dia': 2, cancelado: 3, anulado: 4 };
    return lista.sort((a, b) => {
      switch (this.orden) {
        case 'saldo': return b.s.saldo - a.s.saldo || nombre(a).localeCompare(nombre(b), 'es');
        case 'reciente': return String(b.c.fecha).localeCompare(String(a.c.fecha));
        case 'nombre': return nombre(a).localeCompare(nombre(b), 'es');
        default:
          return rango[a.estado] - rango[b.estado] || b.s.diasAtraso - a.s.diasAtraso
            || String(a.s.proxima?.hasta || '9').localeCompare(String(b.s.proxima?.hasta || '9'))
            || nombre(a).localeCompare(nombre(b), 'es');
      }
    });
  }

  /** % del crédito ya pagado (para la barrita) */
  avance(c: Credito): number {
    const total = Number(c.importe) || 0;
    if (total <= 0) return 0;
    return Math.min(100, Math.round(((total - situacionCredito(c).saldo) / total) * 100));
  }

  // =====================================================
  // DETALLE
  // =====================================================

  async abrir(c: Credito) {
    this.credito = c;
    this.pagos = [];
    this.cargandoDetalle = true;
    try {
      const [actual, pagos] = await Promise.all([this.creditos.obtener(c.id), this.creditos.pagosDe(c.id)]);
      if (actual) this.credito = actual;
      this.pagos = pagos;
    } catch (e: any) {
      console.error('Error leyendo el crédito', e);
      Swal.fire('Error', 'No se pudo leer el crédito. ' + (e?.message || ''), 'error');
    } finally {
      this.cargandoDetalle = false;
    }
    window.scrollTo({ top: 0 });
  }

  cerrarDetalle() {
    this.credito = null;
    this.pagos = [];
  }

  get situacion(): SituacionCredito | null {
    return this.credito ? situacionCredito(this.credito) : null;
  }

  get pagosVisibles(): PagoCredito[] {
    return this.verAnulados ? this.pagos : this.pagos.filter(p => !p.anulado);
  }

  get cantidadPagosAnulados(): number {
    return this.pagos.filter(p => p.anulado).length;
  }

  get totalRecargos(): number {
    return Math.round(this.pagos.filter(p => !p.anulado).reduce((a, p) => a + (Number(p.recargo) || 0), 0) * 100) / 100;
  }

  cuotasDePago(p: PagoCredito): string {
    return (p.aplicaciones || []).map(a => a.numero).join(', ');
  }

  textoPagos(p: PagoCredito): string {
    return textoPagos({ pagos: p.pagos, total: p.cobrado }, n => this.moneda(n));
  }

  nro(n: any): string {
    return n ? String(n).padStart(8, '0') : 'S/N';
  }

  nombreSucursal(id: any): string {
    return this.nombresSucursales[id] || id || '-';
  }

  /** Teléfono para el enlace "llamar" (solo números y +) */
  telefono(t: any): string {
    return String(t || '').replace(/[^\d+]/g, '');
  }

  async verTicket(ventaId: string) {
    try {
      const venta = await this.creditos.ticket(ventaId);
      if (!venta) { Swal.fire('Ticket', 'No se encontró el ticket.', 'warning'); return; }
      this.tickets.abrir(venta, 'vista');
    } catch (e: any) {
      Swal.fire('Error', 'No se pudo abrir el ticket. ' + (e?.message || ''), 'error');
    }
  }

  /** Se puede anular solo si no tiene nada pagado (anula el ticket de la venta y el equipo vuelve al stock) */
  get puedeAnular(): boolean {
    const c = this.credito;
    return !!c && c.estado !== 'anulado' && (Number(c.pagado) || 0) <= 0.004 && !this.pagos.some(p => !p.anulado);
  }

  async anular() {
    const c = this.credito;
    if (!c || !this.puedeAnular || this.anulando) return;
    const r = await Swal.fire({
      title: '¿Anular el crédito?',
      html: `Crédito de <strong>${this.esc(c.cliente?.nombre)}</strong> por ${this.moneda(c.importe)}.<br><br>
             <small>Se anula el <strong>ticket ${this.nro(c.nroTicket)}</strong> de la venta: el equipo vuelve a estar a la venta
             y se revierte todo lo demás del ticket.
             ${c.entrega ? `<br>La entrega (${this.moneda(c.entrega)}) hay que devolvérsela al cliente.` : ''}
             ${c.canje ? `<br>El equipo del plan canje (${this.esc(c.canje.detalle)}) hay que devolvérselo.` : ''}</small>`,
      icon: 'warning',
      input: 'text',
      inputLabel: 'Motivo de la anulación',
      inputPlaceholder: 'Ej: el cliente se arrepintió',
      inputValidator: (v: string) => (!v || v.trim().length < 3) ? 'Ingresá un motivo' : null,
      showCancelButton: true,
      confirmButtonText: 'Anular crédito',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#d33'
    });
    if (!r.isConfirmed) return;

    this.anulando = true;
    try {
      const venta = await this.creditos.ticket(c.ventaId);
      if (!venta) throw new TicketError('No se encontró el ticket de la venta.');
      const res = await this.tickets.anular(venta, r.value);
      const avisos: string[] = ['✔ Crédito anulado'];
      if (res.equiposDevueltos?.length) avisos.push(`✔ Volvieron a estar a la venta: ${res.equiposDevueltos.join(', ')}`);
      if (res.stockDevuelto.length) avisos.push(`✔ Stock devuelto: ${res.stockDevuelto.join(', ')}`);
      const efectivo = efectivoDeVenta(venta);
      if (res.cajaCerrada && efectivo > 0) {
        avisos.push(`⚠ La caja de la venta ya está cerrada. Si devolviste la entrega en efectivo (${this.moneda(efectivo)}), registralo como ` +
          '<strong>retiro</strong> en la caja abierta (Despacho → Movimientos).');
      }
      await Swal.fire({ title: 'Crédito anulado', html: avisos.join('<br>'), icon: 'success' });
      await this.cargar();
    } catch (e: any) {
      const msg = e instanceof TicketError ? e.message : 'No se pudo anular. ' + (e?.message || '');
      if (!(e instanceof TicketError)) console.error('Error anulando crédito', e);
      await Swal.fire('No se pudo anular', msg, 'warning');
    } finally {
      this.anulando = false;
    }
  }

  // =====================================================
  // EXCEL
  // =====================================================

  exportar() {
    const filas = this.visibles;
    if (!filas.length) return;
    const fecha = (iso: any) => iso ? new Date(iso).toLocaleDateString('es-AR') : '';
    const venc = (q: CuotaCredito | null) => q ? q.hasta.split('-').reverse().join('/') : '';
    const nombreEstado = { vencido: 'Con cuotas vencidas', 'por-vencer': 'Vence este mes', 'al-dia': 'Al día', cancelado: 'Terminado', anulado: 'Anulado' };

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas.map(({ c, s, estado }) => ({
      Cliente: c.cliente?.nombre || '',
      DNI: c.cliente?.dni ?? '',
      Teléfono: c.cliente?.telefono || '',
      Dirección: c.cliente?.direccion || '',
      Equipo: (c.equipos || []).map(e => e.nombre).join(', ') || c.detalle,
      IMEI: (c.equipos || []).map(e => e.imei).join(', '),
      'Fecha de compra': fecha(c.fecha),
      'Ticket': this.nro(c.nroTicket),
      Sucursal: this.nombreSucursal(c.sucursalId),
      'Precio contado': Number(c.precioContado) || 0,
      'Precio financiado': Number(c.precioFinanciado) || 0,
      'Plan canje': Number(c.canje?.monto) || 0,
      Entrega: Number(c.entrega) || 0,
      Financiado: Number(c.importe) || 0,
      Cuotas: c.cantidadCuotas,
      'Cuotas pagadas': s.cuotasPagadas,
      Pagado: Math.round(((Number(c.importe) || 0) - s.saldo) * 100) / 100,
      Saldo: estado === 'anulado' ? 0 : s.saldo,
      Vencido: estado === 'anulado' ? 0 : s.montoVencido,
      'Días de atraso': estado === 'anulado' ? '' : (s.diasAtraso || ''),
      'Próxima cuota': estado === 'anulado' ? '' : venc(s.proxima),
      Estado: nombreEstado[estado]
    }))), 'Créditos');

    const cuotas: any[] = [];
    for (const { c, estado } of filas) {
      for (const q of c.cuotas || []) {
        const e = estadoCuota(q);
        cuotas.push({
          Cliente: c.cliente?.nombre || '',
          Teléfono: c.cliente?.telefono || '',
          'Ticket compra': this.nro(c.nroTicket),
          Cuota: `${q.numero}/${c.cantidadCuotas}`,
          Vence: venc(q),
          Importe: Number(q.importe) || 0,
          Pagado: Number(q.pagado) || 0,
          Falta: estado === 'anulado' ? 0 : e.falta,
          Estado: estado === 'anulado' ? 'Anulado'
            : e.estado === 'pagada' ? 'Pagada' : e.estado === 'vencida' ? `Vencida (${e.diasAtraso} días)`
              : e.estado === 'por-vencer' ? 'Vence este mes' : 'A vencer'
        });
      }
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(cuotas.length ? cuotas : [{ '': 'Sin datos' }]), 'Cuotas');
    XLSX.writeFile(wb, `Créditos de la casa ${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  private moneda(n: any): string {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(Number(n) || 0);
  }

  private esc(t: any): string {
    return String(t ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as any)[ch]);
  }
}
