import { Component, OnInit } from '@angular/core';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';
import * as XLSX from 'xlsx';
import Swal from 'sweetalert2';
import {
  CuentaCorrienteService, CuentaCorriente, MovimientoCuenta
} from 'src/app/modules/despacho/services/cuenta-corriente.service';
import { estadoCargo, nombreEstadoCargo, diasDesde, EstadoCargo } from 'src/app/modules/despacho/services/cuenta-corriente';
import { TicketsService } from 'src/app/modules/despacho/services/tickets.service';
import { textoPagos } from 'src/app/modules/despacho/services/pagos';
import { BuscadorClientesService } from 'src/app/shared/services/buscador-clientes.service';

/**
 * Gestiones → Cuentas corrientes (solo consulta).
 * Saldos de los clientes y el detalle de cada cuenta: compras a cuenta (con su estado:
 * pendiente / pago parcial / pagado) y pagos (a qué compras se imputaron).
 * Los cobros se hacen en Despacho, con la caja abierta.
 */
@Component({
  selector: 'app-cuentas-corrientes',
  templateUrl: './cuentas-corrientes.component.html',
  styleUrls: ['./cuentas-corrientes.component.css']
})
export class CuentasCorrientesComponent implements OnInit {

  cargando = false;
  error = '';
  cuentas: CuentaCorriente[] = [];
  filtro = '';
  soloConDeuda = true;
  orden: 'saldo' | 'nombre' | 'antiguedad' = 'saldo';

  // Detalle
  cuenta: CuentaCorriente | null = null;
  movimientos: MovimientoCuenta[] = [];
  /** Saldo de la cuenta después de cada movimiento (calculado sin los anulados) */
  saldoDespues: { [id: string]: number } = {};
  cargandoDetalle = false;
  verAnulados = false;

  readonly diasDesde = diasDesde;
  readonly nombreEstado = nombreEstadoCargo;

  constructor(
    private firestore: Firestore,
    private cuentasService: CuentaCorrienteService,
    private tickets: TicketsService
  ) { }

  ngOnInit() {
    this.cargar();
  }

  async cargar() {
    this.cargando = true;
    this.error = '';
    try {
      this.cuentas = await this.cuentasService.listarCuentas();
      if (this.cuenta) {
        const actual = this.cuentas.find(c => c.id === this.cuenta!.id);
        if (actual) await this.abrir(actual);
      }
    } catch (e: any) {
      console.error('Error cargando cuentas corrientes', e);
      this.error = 'No se pudieron cargar las cuentas corrientes. ' + (e?.message || '');
    } finally {
      this.cargando = false;
    }
  }

  // =====================================================
  // LISTADO
  // =====================================================

  get visibles(): CuentaCorriente[] {
    const palabras = BuscadorClientesService.normalizar(this.filtro).split(' ').filter(Boolean);
    const lista = this.cuentas
      .filter(c => !this.soloConDeuda || c.saldo > 0.004)
      .filter(c => {
        if (!palabras.length) return true;
        const texto = BuscadorClientesService.normalizar(`${c.nombre} ${c.dni ?? ''}`);
        return palabras.every(p => texto.includes(p));
      });
    const porNombre = (a: CuentaCorriente, b: CuentaCorriente) => a.nombre.localeCompare(b.nombre, 'es');
    if (this.orden === 'nombre') return lista.sort(porNombre);
    if (this.orden === 'antiguedad') {
      // Los que hace más que no pagan (o nunca pagaron) primero
      const ref = (c: CuentaCorriente) => c.ultimoPago || c.ultimaCompra || '';
      return lista.sort((a, b) => String(ref(a)).localeCompare(String(ref(b))) || porNombre(a, b));
    }
    return lista.sort((a, b) => b.saldo - a.saldo || porNombre(a, b));
  }

  get totalDeuda(): number {
    return this.redondear(this.cuentas.reduce((a, c) => a + (c.saldo > 0 ? c.saldo : 0), 0));
  }

  get cantidadConDeuda(): number {
    return this.cuentas.filter(c => c.saldo > 0.004).length;
  }

  // =====================================================
  // DETALLE
  // =====================================================

  async abrir(c: CuentaCorriente) {
    this.cuenta = c;
    this.movimientos = [];
    this.cargandoDetalle = true;
    try {
      this.movimientos = await this.cuentasService.movimientos(c.id);
      this.calcularSaldos();
    } catch (e: any) {
      console.error('Error leyendo movimientos', e);
      Swal.fire('Error', 'No se pudieron leer los movimientos de la cuenta. ' + (e?.message || ''), 'error');
    } finally {
      this.cargandoDetalle = false;
    }
  }

  private calcularSaldos() {
    let saldo = 0;
    this.saldoDespues = {};
    [...this.movimientos]
      .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)))
      .forEach(m => {
        if (m.anulado) return;
        saldo = this.redondear(saldo + (m.tipo === 'cargo' ? 1 : -1) * (Number(m.importe) || 0));
        this.saldoDespues[m.id] = saldo;
      });
  }

  cerrarDetalle() {
    this.cuenta = null;
    this.movimientos = [];
  }

  get movimientosVisibles(): MovimientoCuenta[] {
    return this.movimientos.filter(m => this.verAnulados || !m.anulado);
  }

  get cantidadAnulados(): number {
    return this.movimientos.filter(m => m.anulado).length;
  }

  /** Compras con deuda (para el resumen de antigüedad) */
  get comprasPendientes(): MovimientoCuenta[] {
    return this.movimientos
      .filter(m => m.tipo === 'cargo' && !m.anulado && (Number(m.pendiente) || 0) > 0.004)
      .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
  }

  /** Deuda por antigüedad: hasta 30 días, 31 a 60, más de 60 */
  get antiguedad(): { etiqueta: string; monto: number }[] {
    const tramos = [
      { etiqueta: 'Hasta 30 días', monto: 0 },
      { etiqueta: '31 a 60 días', monto: 0 },
      { etiqueta: 'Más de 60 días', monto: 0 }
    ];
    for (const m of this.comprasPendientes) {
      const d = diasDesde(m.fecha);
      tramos[d <= 30 ? 0 : d <= 60 ? 1 : 2].monto += Number(m.pendiente) || 0;
    }
    return tramos.map(t => ({ ...t, monto: this.redondear(t.monto) }));
  }

  estado(m: MovimientoCuenta): EstadoCargo {
    return estadoCargo(m);
  }

  pagos(m: MovimientoCuenta): string {
    return textoPagos({ pagos: m.pagos, total: m.cobrado ?? m.importe }, n => this.moneda(n));
  }

  cobrosVigentes(m: MovimientoCuenta) {
    return (m.cobros || []).filter(c => !c.anulado);
  }

  nro(n: any): string {
    return n ? String(n).padStart(8, '0') : 'S/N';
  }

  nombreCajero(m: MovimientoCuenta): string {
    if (m.cajero) return [m.cajero.nombre, m.cajero.apellido].filter(Boolean).join(' ');
    return m.usuario?.nombre || m.usuario?.usuario || '';
  }

  /** Abre el ticket de la venta / cobro */
  async verTicket(ventaId: string) {
    if (!ventaId) return;
    try {
      const snap = await getDoc(doc(this.firestore, 'Ventas', ventaId));
      if (!snap.exists()) {
        Swal.fire('Ticket', 'No se encontró el ticket.', 'warning');
        return;
      }
      this.tickets.abrir({ id: snap.id, ...snap.data() }, 'vista');
    } catch (e: any) {
      Swal.fire('Error', 'No se pudo abrir el ticket. ' + (e?.message || ''), 'error');
    }
  }

  // =====================================================
  // EXCEL
  // =====================================================

  exportarSaldos() {
    const filas = this.visibles.map(c => ({
      Cliente: c.nombre,
      'DNI / CUIT': c.dni ?? '',
      Saldo: c.saldo,
      'Total comprado a cuenta': c.totalCompras,
      'Total pagado': c.totalPagos,
      'Última compra': c.ultimaCompra ? new Date(c.ultimaCompra).toLocaleDateString('es-AR') : '',
      'Último pago': c.ultimoPago ? new Date(c.ultimoPago).toLocaleDateString('es-AR') : ''
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas.length ? filas : [{ '': 'Sin datos' }]), 'Saldos');
    XLSX.writeFile(wb, `cuentas-corrientes-${this.hoy()}.xlsx`);
  }

  exportarMovimientos() {
    if (!this.cuenta) return;
    const filas = [...this.movimientos]
      .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)))
      .map(m => ({
        Fecha: new Date(m.fecha).toLocaleString('es-AR'),
        Ticket: this.nro(m.nroTicket),
        Tipo: m.tipo === 'cargo' ? 'Compra a cuenta' : 'Pago',
        Debe: m.tipo === 'cargo' ? m.importe : '',
        Haber: m.tipo === 'pago' ? m.importe : '',
        'Saldo después': m.anulado ? '' : (this.saldoDespues[m.id] ?? ''),
        Estado: m.anulado ? 'ANULADO' : m.tipo === 'cargo' ? nombreEstadoCargo(estadoCargo(m)) : '',
        'Pendiente de la compra': m.tipo === 'cargo' && !m.anulado ? (m.pendiente ?? '') : '',
        Detalle: m.tipo === 'cargo'
          ? (m.detalle || '')
          : (m.aplicaciones || []).map(a => `Ticket ${this.nro(a.nroTicket)}: ${a.importe}`).join(' · '),
        'Medio de pago': m.tipo === 'pago' ? this.pagos(m) : '',
        'Pagó (con descuento)': m.tipo === 'pago' ? (m.cobrado ?? m.importe) : '',
        'Descuento efectivo': m.tipo === 'pago' && m.descuento ? m.descuento : '',
        Cajero: this.nombreCajero(m)
      }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas.length ? filas : [{ '': 'Sin datos' }]), 'Movimientos');
    const nombre = this.cuenta.nombre.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').toLowerCase() || 'cliente';
    XLSX.writeFile(wb, `cuenta-${nombre}-${this.hoy()}.xlsx`);
  }

  // =====================================================

  moneda(n: any): string {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(Number(n) || 0);
  }

  private hoy(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private redondear(n: number): number {
    return Math.round((Number(n) || 0) * 100) / 100;
  }
}
