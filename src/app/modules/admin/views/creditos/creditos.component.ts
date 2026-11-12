import { Component, OnInit } from '@angular/core';
import * as XLSX from 'xlsx';
import Swal from 'sweetalert2';
import { ConfigPlanes, Credito, CreditoError, CreditosService, PagoCredito } from 'src/app/modules/despacho/services/creditos.service';
import {
  CuotaCredito, ResumenCartera, SituacionCredito, estadoCuota, faltaCuota, resumenCartera, situacionCredito, textoVencimiento,
  MAX_CUOTAS, PLANES_INICIALES, conInteres, validarPlanes, RECARGO_DIARIO,
  DatosCreditoManual, MAX_CUOTAS_MANUAL, validarCreditoManual, primerMesSugerido, estaBloqueado, ultimaCarta, fechaCorta, mesCuota,
  CUOTAS_PARA_CONFIRMAR, reimputarPagos
} from 'src/app/modules/despacho/services/credito-casa';
import { TicketsService, TicketError } from 'src/app/modules/despacho/services/tickets.service';
import { textoPagos, efectivoDeVenta } from 'src/app/modules/despacho/services/pagos';
import { BuscadorClientesService, ClienteEncontrado } from 'src/app/shared/services/buscador-clientes.service';
import { PermisosService } from 'src/app/core/permisos.service';
import { SucursalesService } from '../../services/sucursales.service';
import { take } from 'rxjs/operators';

type FiltroEstado = 'vencidos' | 'vigentes' | 'al-dia' | 'bloqueados' | 'cancelados' | 'refinanciados' | 'anulados' | 'todos';

/** 'YYYY-MM-DD' de hoy (hora local) */
function hoyTexto(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function altaVacia(): DatosCreditoManual {
  return {
    nombre: '', dni: '', telefono: '', direccion: '', equipo: '', imei: '', detalle: '',
    fechaEntrega: '', entrega: null, cantidadCuotas: null, importeCuota: null, primerMes: ''
  };
}

/** Crédito con su situación calculada (para la lista) */
interface FilaCredito {
  c: Credito;
  s: SituacionCredito;
  estado: 'vencido' | 'por-vencer' | 'al-dia' | 'cancelado' | 'anulado' | 'refinanciado';
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
    { valor: 'bloqueados', nombre: '🔒 Bloqueados' },
    { valor: 'cancelados', nombre: '✅ Terminados' },
    { valor: 'refinanciados', nombre: '🔁 Refinanciados' },
    { valor: 'anulados', nombre: 'Anulados' },
    { valor: 'todos', nombre: 'Todos' }
  ];
  // ⚙️ Planes de cuotas e interés
  mostrarPlanes = false;
  cargandoPlanes = false;
  guardandoPlanes = false;
  planesInfo: ConfigPlanes | null = null;
  planesEdit: { cuotas: number | null; interes: number | null }[] = [];
  errorPlanes = '';
  montoEjemplo = 100000;
  readonly maxCuotas = MAX_CUOTAS;
  readonly recargoDiario = RECARGO_DIARIO;


  // ➕ Cargar crédito existente (dado antes del sistema)
  mostrarAlta = false;
  alta: DatosCreditoManual = altaVacia();
  altaClienteId = '';
  altaSucursalId: string | null = null;
  altaError = '';
  guardandoAlta = false;
  buscarCliente = '';
  sugerencias: ClienteEncontrado[] = [];
  sucursales: { id: string; nombre: string }[] = [];
  readonly maxCuotasManual = MAX_CUOTAS_MANUAL;
  readonly hoy = hoyTexto();

  // ✏️ Edición de un crédito cargado a mano (solo superadministradores)
  esSuperAdmin = false;
  editandoId: string | null = null;
  private pagosEdicion: PagoCredito[] = [];

  // 🧾 Pago anterior (de la planilla) en un crédito cargado a mano
  pagoAnt: { fecha: string; importe: number | null; recargo: number | null; nota: string } = { fecha: '', importe: null, recargo: null, nota: '' };
  guardandoPagoAnt = false;
  errorPagoAnt = '';
  procesando = false;

  readonly estadoCuota = estadoCuota;
  readonly faltaCuota = faltaCuota;
  readonly textoVencimiento = textoVencimiento;
  readonly estaBloqueado = estaBloqueado;
  readonly ultimaCarta = ultimaCarta;
  readonly fechaCorta = fechaCorta;

  constructor(
    private creditos: CreditosService,
    private tickets: TicketsService,
    private sucursalesService: SucursalesService,
    private buscador: BuscadorClientesService,
    private permisos: PermisosService
  ) { }

  ngOnInit() {
    this.sucursalesService.obtenerSucursales().pipe(take(1)).subscribe(lista => {
      (lista || []).forEach((s: any) => this.nombresSucursales[s.id] = s.nombre || s.id);
      this.sucursales = (lista || []).map((s: any) => ({ id: s.id, nombre: s.nombre || s.id }));
    });
    this.cargar();
    this.permisos.esSuperAdmin().then(v => this.esSuperAdmin = v === true).catch(() => this.esSuperAdmin = false);
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
          : c.estado === 'refinanciado' ? 'refinanciado'
          : (c.estado === 'cancelado' || s.estado === 'cancelado') ? 'cancelado' : s.estado as any;
        return { c, s, estado };
      });
      if (this.credito) {
        const actual = this.filas.find(f => f.c.id === this.credito!.id);
        if (actual) await this.abrir(actual.c, false);
      }
    } catch (e: any) {
      console.error('Error cargando créditos', e);
      this.error = 'No se pudieron cargar los créditos. ' + (e?.message || '');
    } finally {
      this.cargando = false;
    }
  }

  // =====================================================
  // ⚙️ PLANES DE CUOTAS E INTERÉS
  // =====================================================

  async abrirPlanes() {
    if (this.mostrarPlanes) { this.mostrarPlanes = false; return; }
    this.mostrarPlanes = true;
    this.cargandoPlanes = true;
    this.errorPlanes = '';
    try {
      this.planesInfo = await this.creditos.planes();
      this.planesEdit = this.planesInfo.planes.map(p => ({ ...p }));
    } finally {
      this.cargandoPlanes = false;
    }
  }

  agregarPlan() {
    const usadas = new Set(this.planesEdit.map(p => Number(p.cuotas)));
    let libre: number | null = null;
    for (let n = 1; n <= MAX_CUOTAS; n++) if (!usadas.has(n)) { libre = n; break; }
    this.planesEdit.push({ cuotas: libre, interes: null });
    this.errorPlanes = '';
  }

  quitarPlan(i: number) {
    this.planesEdit.splice(i, 1);
    this.errorPlanes = '';
  }

  restablecerIniciales() {
    this.planesEdit = PLANES_INICIALES.map(p => ({ ...p }));
    this.errorPlanes = '';
  }

  /** Ejemplo: con $montoEjemplo financiados, cuánto se paga en total y por cuota */
  ejemplo(p: { cuotas: number | null; interes: number | null }): { total: number; cuota: number } | null {
    const n = Number(p.cuotas), i = Number(p.interes);
    if (!(n >= 1) || p.interes === null || String(p.interes) === '' || !(i >= 0)) return null;
    const total = conInteres(Number(this.montoEjemplo) || 0, i);
    return { total, cuota: Math.round(total / n) };
  }

  get errorValidacionPlanes(): string | null {
    return validarPlanes(this.planesEdit).error;
  }

  async guardarPlanes() {
    if (this.guardandoPlanes) return;
    const error = this.errorValidacionPlanes;
    if (error) { this.errorPlanes = error; return; }
    this.guardandoPlanes = true;
    try {
      const planes = await this.creditos.guardarPlanes(this.planesEdit);
      this.planesInfo = await this.creditos.planes();
      this.planesEdit = planes.map(p => ({ ...p }));
      this.errorPlanes = '';
      Swal.fire({ title: 'Planes guardados', text: 'Despacho ya ofrece estos planes en las próximas ventas.', icon: 'success', timer: 2200, showConfirmButton: false });
    } catch (e: any) {
      this.errorPlanes = e instanceof CreditoError ? e.message : 'No se pudieron guardar los planes. ' + (e?.message || '');
      if (!(e instanceof CreditoError)) console.error('Error guardando planes', e);
    } finally {
      this.guardandoPlanes = false;
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
      case 'bloqueados': return estaBloqueado(x.c) && x.estado !== 'cancelado' && x.estado !== 'refinanciado';
      case 'refinanciados': return x.estado === 'refinanciado';
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
          `${c.cliente?.nombre} ${c.cliente?.dni ?? ''} ${c.cliente?.telefono ?? ''} ${c.detalle ?? ''} ${estaBloqueado(c) ? 'bloqueado carta documento' : ''} ` +
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

  /** 🔁 Abre el crédito vinculado (el nuevo de una refinanciación o el anterior) */
  async abrirVinculado(id: string | null | undefined) {
    if (!id) return;
    let fila = this.filas.find(f => f.c.id === id);
    if (!fila) {
      this.filtroEstado = 'todos';
      fila = this.filas.find(f => f.c.id === id);
    }
    if (fila) await this.abrir(fila.c);
    else Swal.fire('No se encontró', 'No se encontró el crédito vinculado.', 'info');
  }

  async abrir(c: Credito, subir = true) {
    const otro = this.credito?.id !== c.id;
    this.credito = c;
    this.pagos = [];
    this.cargandoDetalle = true;
    try {
      const [actual, pagos] = await Promise.all([this.creditos.obtener(c.id), this.creditos.pagosDe(c.id)]);
      if (actual) this.credito = actual;
      this.pagos = pagos;
      if (otro) { this.pagoAnt.fecha = ''; this.prepararPagoAnt(); }
    } catch (e: any) {
      console.error('Error leyendo el crédito', e);
      Swal.fire('Error', 'No se pudo leer el crédito. ' + (e?.message || ''), 'error');
    } finally {
      this.cargandoDetalle = false;
    }
    if (subir) window.scrollTo({ top: 0 });
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
    return !!c && c.origen !== 'manual' && c.estado !== 'anulado' && (Number(c.pagado) || 0) <= 0.004 && !this.pagos.some(p => !p.anulado);
  }

  /** Crédito cargado a mano: se anula si no tiene cobros hechos en Despacho (los pagos anteriores no importan) */
  get puedeAnularManual(): boolean {
    const c = this.credito;
    return !!c && c.origen === 'manual' && c.estado !== 'anulado' && c.estado !== 'refinanciado' && !this.pagos.some(p => !p.anulado && !p.anterior);
  }

  async anularManual() {
    const c = this.credito;
    if (!c || !this.puedeAnularManual || this.anulando) return;
    const r = await Swal.fire({
      title: '¿Anular el crédito cargado a mano?',
      html: `Crédito de <strong>${this.esc(c.cliente?.nombre)}</strong> por ${this.moneda(c.importe)}.<br>
             <small>Usalo si se cargó mal: después lo podés volver a cargar.</small>`,
      icon: 'warning',
      input: 'text',
      inputLabel: 'Motivo',
      inputPlaceholder: 'Ej: me equivoqué en las cuotas',
      inputValidator: (v: string) => (!v || v.trim().length < 3) ? 'Ingresá un motivo' : null,
      showCancelButton: true,
      confirmButtonText: 'Anular crédito',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#d33'
    });
    if (!r.isConfirmed) return;
    this.anulando = true;
    try {
      await this.creditos.anularManual(c.id, r.value);
      await this.cargar();
    } catch (e: any) {
      Swal.fire('No se pudo anular', e instanceof CreditoError ? e.message : (e?.message || ''), 'warning');
    } finally {
      this.anulando = false;
    }
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
      if (res.canjeDevuelto) avisos.push(`✔ El equipo del plan canje (${res.canjeDevuelto}) se dio de baja: hay que devolvérselo al cliente`);
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
  // ➕ CARGAR CRÉDITO EXISTENTE
  // =====================================================

  abrirAlta() {
    if (this.editandoId) { this.cancelarEdicion(); return; }
    this.mostrarAlta = !this.mostrarAlta;
    if (this.mostrarAlta) this.mostrarPlanes = false;
  }

  /** ✏️ Abre el formulario con los datos del crédito (cargado a mano) para corregirlo */
  editar() {
    const c = this.credito;
    if (!c || !this.puedeEditar) return;
    const f = new Date(c.fecha);
    const dosDig = (n: number) => String(n).padStart(2, '0');
    this.alta = {
      nombre: c.cliente?.nombre || '',
      dni: c.cliente?.dni ?? '',
      telefono: c.cliente?.telefono || '',
      direccion: c.cliente?.direccion || '',
      equipo: c.equipos?.[0]?.nombre || '',
      imei: c.equipos?.[0]?.imei || '',
      detalle: c.detalle || '',
      fechaEntrega: `${f.getFullYear()}-${dosDig(f.getMonth() + 1)}-${dosDig(f.getDate())}`,
      entrega: Number(c.entrega) || null,
      cantidadCuotas: c.cantidadCuotas,
      importeCuota: c.cuotas?.[0]?.importe ?? null,
      primerMes: String(c.cuotas?.[0]?.desde || '').slice(0, 7)
    };
    this.altaClienteId = c.cliente?.id || '';
    this.altaSucursalId = c.sucursalId || null;
    this.altaError = '';
    this.pagosEdicion = [...this.pagos];
    this.editandoId = c.id;
    this.credito = null;
    this.mostrarPlanes = false;
    this.mostrarAlta = true;
    window.scrollTo({ top: 0 });
  }

  async cancelarEdicion() {
    const id = this.editandoId;
    this.editandoId = null;
    this.mostrarAlta = false;
    this.limpiarAlta();
    const fila = id ? this.filas.find(f => f.c.id === id) : null;
    if (fila) await this.abrir(fila.c);
  }

  get puedeEditar(): boolean {
    const c = this.credito;
    return this.esSuperAdmin && !!c && c.origen === 'manual' && (c.estado === 'vigente' || c.estado === 'cancelado');
  }

  /** En la edición: cómo quedan los pagos que ya hizo sobre las cuotas corregidas */
  get previaPagosEdicion(): { pagos: number; pagado: number; cuotasPagadas: number; saldo: number; error: string | null } | null {
    if (!this.editandoId) return null;
    const vigentes = this.pagosEdicion.filter(p => !p.anulado);
    if (!vigentes.length) return null;
    const v = validarCreditoManual(this.alta);
    if (!v.cuotas) return null;
    const r = reimputarPagos(v.cuotas, vigentes as any);
    return {
      pagos: vigentes.length,
      pagado: r.pagado,
      cuotasPagadas: r.cuotas.filter(q => q.importe - q.pagado <= 0.004).length,
      saldo: r.cuotas.reduce((a, q) => a + Math.max(0, q.importe - q.pagado), 0),
      error: r.error
    };
  }

  /** Antes de guardar: si son muchas cuotas, que lo confirmen (un 6 tipeado como 60) */
  private async confirmarCantidadCuotas(): Promise<boolean> {
    const n = Number(this.alta.cantidadCuotas) || 0;
    if (n <= CUOTAS_PARA_CONFIRMAR) return true;
    const r = await Swal.fire({
      title: `¿Seguro que son ${n} cuotas?`,
      html: `${n} cuotas de ${this.moneda(Number(this.alta.importeCuota) || 0)} = <strong>${this.moneda(n * (Number(this.alta.importeCuota) || 0))}</strong>`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: `Sí, son ${n}`,
      cancelButtonText: 'Corregir'
    });
    return r.isConfirmed;
  }

  limpiarAlta() {
    this.alta = altaVacia();
    this.altaClienteId = '';
    this.buscarCliente = '';
    this.sugerencias = [];
    this.altaError = '';
  }

  async alBuscarCliente(texto: string) {
    const valor = (texto || '').trim();
    if (valor.length < 3) { this.sugerencias = []; return; }
    try {
      const lista = await this.buscador.buscar(valor, 8);
      if (this.buscarCliente.trim() === valor) this.sugerencias = lista;
    } catch (e) {
      console.error('Error buscando clientes', e);
    }
  }

  etiquetaCliente(c: ClienteEncontrado): string {
    return BuscadorClientesService.etiqueta(c);
  }

  /** Completa los datos del cliente con uno del sistema (queda vinculado) */
  elegirCliente(c: ClienteEncontrado) {
    this.altaClienteId = c.id;
    this.alta.nombre = [c.nombre, c.apellido].filter(Boolean).join(' ') || c.razonSocial || '';
    this.alta.dni = c.dni || '';
    this.alta.telefono = c.telefono || '';
    this.alta.direccion = c.data?.direccion || '';
    this.sugerencias = [];
    this.buscarCliente = '';
    this.altaError = '';
  }

  desvincularCliente() {
    this.altaClienteId = '';
  }

  /** Al cambiar la fecha de entrega se propone el mes de la primera cuota (si todavía no se eligió) */
  cambioFechaEntrega() {
    if (this.alta.fechaEntrega && !this.alta.primerMes) this.alta.primerMes = primerMesSugerido(this.alta.fechaEntrega);
    this.altaError = '';
  }

  /** Vista previa de las cuotas (o null si faltan datos) */
  get previaAlta(): { cuotas: number; importe: number; desde: string; hasta: string } | null {
    const v = validarCreditoManual(this.alta);
    if (!v.cuotas) return null;
    const l = v.cuotas;
    return {
      cuotas: l.length,
      importe: l.reduce((a, q) => a + q.importe, 0),
      desde: mesCuota(l[0]),
      hasta: mesCuota(l[l.length - 1])
    };
  }

  async guardarAlta() {
    if (this.guardandoAlta) return;
    const v = validarCreditoManual(this.alta);
    if (v.error) { this.altaError = v.error; return; }
    if (this.editandoId && this.previaPagosEdicion?.error) { this.altaError = this.previaPagosEdicion.error; return; }
    if (!(await this.confirmarCantidadCuotas())) return;
    if (this.editandoId) { await this.guardarEdicion(); return; }
    this.guardandoAlta = true;
    try {
      const id = await this.creditos.crearManual(this.alta, this.altaClienteId, this.altaSucursalId);
      const nombre = this.alta.nombre;
      this.limpiarAlta();
      this.mostrarAlta = false;
      await this.cargar();
      const r = await Swal.fire({
        title: 'Crédito cargado',
        html: `Se cargó el crédito de <strong>${this.esc(nombre)}</strong>.<br><small>Ahora podés cargarle los pagos que ya hizo.</small>`,
        icon: 'success',
        showCancelButton: true,
        confirmButtonText: 'Cargar pagos',
        cancelButtonText: 'Seguir'
      });
      if (r.isConfirmed) {
        const fila = this.filas.find(f => f.c.id === id);
        if (fila) await this.abrir(fila.c);
      }
    } catch (e: any) {
      this.altaError = e instanceof CreditoError ? e.message : 'No se pudo guardar. ' + (e?.message || '');
      if (!(e instanceof CreditoError)) console.error('Error cargando crédito', e);
    } finally {
      this.guardandoAlta = false;
    }
  }

  private async guardarEdicion() {
    const id = this.editandoId!;
    this.guardandoAlta = true;
    try {
      const r = await this.creditos.editarManual(id, this.alta, this.altaClienteId, this.altaSucursalId);
      this.editandoId = null;
      this.mostrarAlta = false;
      this.limpiarAlta();
      await this.cargar();
      const fila = this.filas.find(f => f.c.id === id);
      if (fila) await this.abrir(fila.c);
      Swal.fire({
        title: 'Crédito corregido',
        text: `${r.cuotasPagadas} cuota(s) pagada(s) · saldo ${this.moneda(r.saldo)}`,
        icon: 'success', timer: 2200, showConfirmButton: false
      });
    } catch (e: any) {
      this.altaError = e instanceof CreditoError ? e.message : 'No se pudo guardar. ' + (e?.message || '');
      if (!(e instanceof CreditoError)) console.error('Error editando crédito', e);
    } finally {
      this.guardandoAlta = false;
    }
  }

  // =====================================================
  // 🧾 PAGOS ANTERIORES (créditos cargados a mano)
  // =====================================================

  get esManual(): boolean {
    return this.credito?.origen === 'manual';
  }

  /** Propone el importe de la próxima cuota que falta */
  private prepararPagoAnt() {
    const s = this.situacion;
    this.pagoAnt = { fecha: this.pagoAnt.fecha || '', importe: s?.proxima ? faltaCuota(s.proxima) : null, recargo: null, nota: '' };
    this.errorPagoAnt = '';
  }

  async guardarPagoAnterior() {
    const c = this.credito;
    if (!c || this.guardandoPagoAnt) return;
    this.guardandoPagoAnt = true;
    this.errorPagoAnt = '';
    try {
      const r = await this.creditos.registrarPagoAnterior(c.id, this.pagoAnt);
      const fecha = this.pagoAnt.fecha;
      await this.abrir(c, false);
      this.pagoAnt.fecha = fecha;          // para cargar varios seguidos: se cambia solo el mes
      this.prepararPagoAnt();
      Swal.fire({
        title: 'Pago cargado',
        text: `Cuota(s) ${r.aplicaciones.map(a => a.numero).join(', ')} · saldo ${this.moneda(r.saldo)}`,
        icon: 'success', timer: 1500, showConfirmButton: false
      });
    } catch (e: any) {
      this.errorPagoAnt = e instanceof CreditoError ? e.message : 'No se pudo guardar. ' + (e?.message || '');
      if (!(e instanceof CreditoError)) console.error('Error cargando pago anterior', e);
    } finally {
      this.guardandoPagoAnt = false;
    }
  }

  async anularPagoAnterior(p: PagoCredito) {
    const c = this.credito;
    if (!c || !p.anterior || p.anulado || this.procesando) return;
    const r = await Swal.fire({
      title: '¿Anular este pago?',
      html: `${this.moneda(p.importe)} del ${new Date(p.fecha).toLocaleDateString('es-AR')} (cuota(s) ${this.cuotasDePago(p)}).<br>
             <small>Las cuotas vuelven a quedar pendientes.</small>`,
      icon: 'warning',
      input: 'text',
      inputLabel: 'Motivo',
      inputPlaceholder: 'Ej: lo cargué dos veces',
      inputValidator: (v: string) => (!v || v.trim().length < 3) ? 'Ingresá un motivo' : null,
      showCancelButton: true,
      confirmButtonText: 'Anular pago',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#d33'
    });
    if (!r.isConfirmed) return;
    this.procesando = true;
    try {
      await this.creditos.anularPagoAnterior(c.id, p.id, r.value);
      await this.abrir(c, false);
      this.prepararPagoAnt();
    } catch (e: any) {
      Swal.fire('No se pudo anular', e instanceof CreditoError ? e.message : (e?.message || ''), 'warning');
    } finally {
      this.procesando = false;
    }
  }

  // =====================================================
  // ✉️ CARTA DOCUMENTO Y BLOQUEO
  // =====================================================

  async registrarCarta() {
    const c = this.credito;
    if (!c || this.procesando) return;
    const r = await Swal.fire({
      title: 'Carta documento',
      html: `<div class="text-start small mb-2">Se registra la intimación a <strong>${this.esc(c.cliente?.nombre)}</strong> y el crédito queda
               <strong>bloqueado</strong>. Las cuotas se le pueden seguir cobrando en Despacho.</div>
             <label class="form-label small mb-1 d-block text-start" for="swal-fecha-carta">Fecha de envío</label>
             <input id="swal-fecha-carta" type="date" class="form-control mb-2" value="${this.hoy}" max="${this.hoy}">
             <label class="form-label small mb-1 d-block text-start" for="swal-obs-carta">Observación (opcional)</label>
             <input id="swal-obs-carta" type="text" class="form-control" maxlength="300" placeholder="Ej: por 2 cuotas impagas, la envió el abogado">`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Registrar y bloquear',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#d33',
      focusConfirm: false,
      preConfirm: () => {
        const fecha = (document.getElementById('swal-fecha-carta') as HTMLInputElement)?.value || '';
        const observacion = (document.getElementById('swal-obs-carta') as HTMLInputElement)?.value || '';
        if (!fecha) { Swal.showValidationMessage('Ingresá la fecha'); return false; }
        if (fecha > this.hoy) { Swal.showValidationMessage('La fecha no puede ser posterior a hoy'); return false; }
        return { fecha, observacion };
      }
    });
    if (!r.isConfirmed || !r.value) return;
    this.procesando = true;
    try {
      await this.creditos.registrarCartaDocumento(c.id, r.value as any);
      await this.cargar();
    } catch (e: any) {
      Swal.fire('No se pudo registrar', e instanceof CreditoError ? e.message : (e?.message || ''), 'warning');
    } finally {
      this.procesando = false;
    }
  }

  async desbloquear() {
    const c = this.credito;
    if (!c || this.procesando) return;
    const r = await Swal.fire({
      title: '¿Desbloquear el crédito?',
      input: 'text',
      inputLabel: 'Motivo',
      inputPlaceholder: 'Ej: se puso al día',
      inputValidator: (v: string) => (!v || v.trim().length < 3) ? 'Ingresá un motivo' : null,
      showCancelButton: true,
      confirmButtonText: 'Desbloquear',
      cancelButtonText: 'Cancelar'
    });
    if (!r.isConfirmed) return;
    this.procesando = true;
    try {
      await this.creditos.desbloquear(c.id, r.value);
      await this.cargar();
    } catch (e: any) {
      Swal.fire('No se pudo desbloquear', e instanceof CreditoError ? e.message : (e?.message || ''), 'warning');
    } finally {
      this.procesando = false;
    }
  }

  get cartasOrdenadas() {
    return [...(this.credito?.cartasDocumento || [])].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  }

  // =====================================================
  // EXCEL
  // =====================================================

  exportar() {
    const filas = this.visibles;
    if (!filas.length) return;
    const fecha = (iso: any) => iso ? new Date(iso).toLocaleDateString('es-AR') : '';
    const venc = (q: CuotaCredito | null) => q ? q.hasta.split('-').reverse().join('/') : '';
    const nombreEstado = { vencido: 'Con cuotas vencidas', 'por-vencer': 'Vence este mes', 'al-dia': 'Al día', cancelado: 'Terminado', anulado: 'Anulado', refinanciado: 'Refinanciado' };

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas.map(({ c, s, estado }) => ({
      Cliente: c.cliente?.nombre || '',
      DNI: c.cliente?.dni ?? '',
      Teléfono: c.cliente?.telefono || '',
      Dirección: c.cliente?.direccion || '',
      Equipo: (c.equipos || []).map(e => e.nombre).join(', ') || c.detalle,
      IMEI: (c.equipos || []).map(e => e.imei).join(', '),
      'Fecha de compra': fecha(c.fecha),
      'Ticket': c.origen === 'manual' ? 'Cargado a mano' : this.nro(c.nroTicket),
      Sucursal: this.nombreSucursal(c.sucursalId),
      'Precio contado': Number(c.precioContado) || 0,
      'Precio financiado': Number(c.precioFinanciado) || 0,
      'Interés %': c.interes ?? '',
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
      Estado: nombreEstado[estado],
      Bloqueado: estaBloqueado(c) ? 'Sí' : '',
      'Carta documento': ultimaCarta(c) ? fechaCorta(ultimaCarta(c)!.fecha) : '',
      Detalle: c.detalle || ''
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
