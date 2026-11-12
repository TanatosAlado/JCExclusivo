import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { AuthService } from 'src/app/modules/auth/services/auth.service';
import { CompraHistorial, TEXTO_ESTADO, TipoCompra } from 'src/app/shared/utils/historial-cliente';
import { EstadoCuentaCliente, MIN_LARGO_CLAVE, MiCuentaError, MiCuentaService, MovimientoCliente } from '../../services/mi-cuenta.service';
import { CreditoCliente, CuotaCliente, RECARGO_DIARIO_CLIENTE, resumenCreditosCliente } from 'src/app/shared/utils/creditos-cliente';
import { errorDatosSolicitud, estadoSolicitud, formatearCuit, puedePedirMayorista } from 'src/app/shared/utils/solicitud-mayorista';

type Pestana = 'compras' | 'cuenta' | 'creditos' | 'datos' | 'clave';
type Filtro = 'todas' | 'web' | 'local';

/**
 * Perfil del cliente: historial de compras (web y local), datos de contacto,
 * puntos y cambio de contraseña. Solo para clientes con cuenta (no invitados).
 */
@Component({
  selector: 'app-mi-cuenta',
  templateUrl: './mi-cuenta.component.html',
  styleUrls: ['./mi-cuenta.component.css']
})
export class MiCuentaComponent implements OnInit, OnDestroy {

  pestana: Pestana = 'compras';
  cliente: any = null;
  cargando = true;
  error: string | null = null;

  // Compras
  compras: CompraHistorial[] = [];
  cargandoCompras = false;
  errorCompras: string | null = null;
  filtro: Filtro = 'todas';
  abiertas = new Set<string>();
  readonly textoEstado = TEXTO_ESTADO;

  // 📒 Cuenta corriente (solo para ver; la solapa aparece si tiene cuenta)
  cuenta: EstadoCuentaCliente | null = null;
  cargandoCuenta = false;
  errorCuenta: string | null = null;
  verAnulados = false;

  // 🏠 Créditos de la casa (solo para ver; la solapa aparece si tiene alguno)
  creditos: CreditoCliente[] = [];
  cargandoCreditos = false;
  errorCreditos: string | null = null;
  creditosAbiertos = new Set<string>();
  verTerminados = false;
  readonly recargoDiario = RECARGO_DIARIO_CLIENTE;

  // Datos
  telefono = '';
  direccion = '';
  guardandoDatos = false;
  mensajeDatos: { ok: boolean; texto: string } | null = null;

  // Contraseña
  claveActual = '';
  claveNueva = '';
  claveRepetida = '';
  verClaves = false;
  guardandoClave = false;
  mensajeClave: { ok: boolean; texto: string } | null = null;
  readonly minLargoClave = MIN_LARGO_CLAVE;

  // Cuenta mayorista
  mostrarFormMayorista = false;
  razonSocial = '';
  cuit = '';
  enviandoSolicitud = false;
  mensajeMayorista: { ok: boolean; texto: string } | null = null;
  readonly formatearCuit = formatearCuit;

  private sub?: Subscription;

  constructor(
    private miCuenta: MiCuentaService,
    private authService: AuthService,
    private router: Router
  ) { }

  ngOnInit(): void {
    // Si cierra sesión estando acá (o es invitado), vuelve a la tienda
    this.sub = this.authService.getUsuarioActual().subscribe(c => {
      if (!c || c.id === 'invitado') this.router.navigate(['/inicio']);
    });
    const actual = this.authService.getClienteActualValor();
    if (!actual || actual.id === 'invitado') return;
    this.cargar();
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  async cargar() {
    this.cargando = true;
    this.error = null;
    try {
      this.cliente = await this.miCuenta.obtenerCliente();
      this.telefono = this.cliente.telefono || '';
      this.direccion = this.cliente.direccion || '';
      this.cargarCompras();
      this.cargarCuenta();
      this.cargarCreditos();
    } catch (err: any) {
      this.error = err instanceof MiCuentaError ? err.message : 'No pudimos cargar tu cuenta. Probá de nuevo.';
      console.error(err);
    } finally {
      this.cargando = false;
    }
  }

  async cargarCuenta() {
    this.cargandoCuenta = true;
    this.errorCuenta = null;
    try {
      this.cuenta = await this.miCuenta.obtenerCuentaCorriente();
    } catch (err) {
      console.error(err);
      this.errorCuenta = 'No pudimos cargar tu cuenta corriente. Probá de nuevo.';
    } finally {
      this.cargandoCuenta = false;
    }
  }

  async cargarCreditos() {
    this.cargandoCreditos = true;
    this.errorCreditos = null;
    try {
      this.creditos = await this.miCuenta.obtenerCreditos();
      // Los que tienen deuda se muestran abiertos
      this.creditosAbiertos = new Set(this.creditos.filter(c => c.estado === 'vigente').map(c => c.id));
    } catch (err) {
      console.error(err);
      this.errorCreditos = 'No pudimos cargar tus créditos. Probá de nuevo.';
    } finally {
      this.cargandoCreditos = false;
    }
  }

  get resumenCreditos() {
    return resumenCreditosCliente(this.creditos);
  }

  get hayCreditosAtrasados(): boolean {
    return this.creditos.some(c => c.estado === 'vigente' && c.situacion.estado === 'vencido');
  }

  /** Créditos a mostrar (los terminados o refinanciados, solo si los pide, salvo que no haya vigentes) */
  get creditosVisibles(): CreditoCliente[] {
    const vigentes = this.creditos.filter(c => c.estado === 'vigente');
    return this.verTerminados || !vigentes.length ? this.creditos : vigentes;
  }

  get hayCreditosTerminados(): boolean {
    return this.creditos.some(c => c.estado !== 'vigente') && this.creditos.some(c => c.estado === 'vigente');
  }

  /** La primera cuota que falta pagar del crédito */
  proximaDe(c: CreditoCliente): CuotaCliente | null {
    return c.cuotas.find(q => q.estado !== 'pagada') || null;
  }

  alternarCredito(id: string) {
    if (this.creditosAbiertos.has(id)) this.creditosAbiertos.delete(id);
    else this.creditosAbiertos.add(id);
  }

  /** Movimientos a mostrar (los anulados, solo si los pide) */
  get movimientosVisibles(): MovimientoCliente[] {
    return (this.cuenta?.movimientos || []).filter(m => this.verAnulados || !m.anulado);
  }

  get hayAnulados(): boolean {
    return (this.cuenta?.movimientos || []).some(m => m.anulado);
  }

  nroTicket(n: number | null): string {
    return n === null || n === undefined ? '' : String(n).padStart(8, '0');
  }

  async cargarCompras() {
    this.cargandoCompras = true;
    this.errorCompras = null;
    try {
      this.compras = await this.miCuenta.obtenerHistorial(this.cliente);
    } catch (err) {
      console.error(err);
      this.errorCompras = 'No pudimos cargar tus compras. Probá de nuevo.';
    } finally {
      this.cargandoCompras = false;
    }
  }

  // ---------- Encabezado ----------

  get nombreCompleto(): string {
    return [this.cliente?.nombre, this.cliente?.apellido].filter(Boolean).join(' ') || this.cliente?.usuario || '';
  }

  get iniciales(): string {
    return [this.cliente?.nombre, this.cliente?.apellido]
      .filter(Boolean).map((s: string) => s.trim()[0] || '').join('').toUpperCase() || '?';
  }

  /** Los puntos son solo para clientes minoristas */
  get muestraPuntos(): boolean {
    return !!this.cliente && !this.cliente.esMayorista;
  }

  // ---------- Compras ----------

  private esDelFiltro(tipo: TipoCompra): boolean {
    if (this.filtro === 'web') return tipo === 'web';
    if (this.filtro === 'local') return tipo !== 'web';
    return true;
  }

  get comprasFiltradas(): CompraHistorial[] {
    return this.compras.filter(c => this.esDelFiltro(c.tipo));
  }

  cantidad(filtro: Filtro): number {
    if (filtro === 'web') return this.compras.filter(c => c.tipo === 'web').length;
    if (filtro === 'local') return this.compras.filter(c => c.tipo !== 'web').length;
    return this.compras.length;
  }

  alternar(c: CompraHistorial) {
    if (this.abiertas.has(c.clave)) this.abiertas.delete(c.clave);
    else this.abiertas.add(c.clave);
  }

  icono(c: CompraHistorial): string {
    return c.tipo === 'web' ? 'fa-globe' : c.tipo === 'reparacion' ? 'fa-tools'
      : c.tipo === 'cuenta' ? 'fa-file-invoice-dollar' : 'fa-store';
  }

  trackCompra = (_: number, c: CompraHistorial) => c.clave;

  // ---------- Datos ----------

  get datosCambiados(): boolean {
    return this.telefono.trim() !== (this.cliente?.telefono || '') || this.direccion.trim() !== (this.cliente?.direccion || '');
  }

  async guardarDatos() {
    if (this.guardandoDatos || !this.datosCambiados) return;
    this.guardandoDatos = true;
    this.mensajeDatos = null;
    try {
      await this.miCuenta.actualizarDatos({ telefono: this.telefono, direccion: this.direccion });
      this.cliente = { ...this.cliente, telefono: this.telefono.trim(), direccion: this.direccion.trim() };
      this.telefono = this.cliente.telefono;
      this.direccion = this.cliente.direccion;
      this.mensajeDatos = { ok: true, texto: 'Tus datos se guardaron.' };
    } catch (err: any) {
      console.error(err);
      this.mensajeDatos = { ok: false, texto: err instanceof MiCuentaError ? err.message : 'No se pudieron guardar los datos. Probá de nuevo.' };
    } finally {
      this.guardandoDatos = false;
    }
  }

  // ---------- Cuenta mayorista ----------

  get estadoMayorista(): 'mayorista' | 'pendiente' | 'rechazada' | 'minorista' {
    if (this.cliente?.esMayorista) return 'mayorista';
    const e = estadoSolicitud(this.cliente);
    return e === 'pendiente' ? 'pendiente' : e === 'rechazada' ? 'rechazada' : 'minorista';
  }

  get puedePedir(): boolean {
    return puedePedirMayorista(this.cliente);
  }

  get errorSolicitud(): string | null {
    if (!this.razonSocial.trim() && !this.cuit.trim()) return null;
    return errorDatosSolicitud({ razonSocial: this.razonSocial, cuit: this.cuit });
  }

  abrirFormMayorista() {
    this.mostrarFormMayorista = true;
    this.mensajeMayorista = null;
    // Si la pidió antes y se la rechazaron, se le proponen los mismos datos
    this.razonSocial = this.cliente?.solicitudMayorista?.razonSocial || this.cliente?.razonSocial || '';
    this.cuit = this.cliente?.solicitudMayorista?.cuit || this.cliente?.cuit || '';
  }

  async pedirMayorista() {
    if (this.enviandoSolicitud) return;
    const error = errorDatosSolicitud({ razonSocial: this.razonSocial, cuit: this.cuit });
    if (error) {
      this.mensajeMayorista = { ok: false, texto: error };
      return;
    }
    this.enviandoSolicitud = true;
    this.mensajeMayorista = null;
    try {
      const solicitud = await this.miCuenta.pedirMayorista(this.cliente, { razonSocial: this.razonSocial, cuit: this.cuit });
      this.cliente = { ...this.cliente, solicitudMayorista: solicitud };
      this.mostrarFormMayorista = false;
      this.mensajeMayorista = { ok: true, texto: 'Listo: tu solicitud quedó en revisión. Te avisamos cuando esté aprobada.' };
    } catch (err: any) {
      console.error(err);
      this.mensajeMayorista = { ok: false, texto: err instanceof MiCuentaError ? err.message : 'No se pudo enviar la solicitud. Probá de nuevo.' };
    } finally {
      this.enviandoSolicitud = false;
    }
  }

  // ---------- Contraseña ----------

  get errorClaveNueva(): string | null {
    if (!this.claveNueva) return null;
    if (this.claveNueva.length < this.minLargoClave) return `Tiene que tener al menos ${this.minLargoClave} caracteres.`;
    if (this.claveActual && this.claveNueva === this.claveActual) return 'Tiene que ser distinta de la actual.';
    return null;
  }

  get noCoinciden(): boolean {
    return !!this.claveRepetida && this.claveRepetida !== this.claveNueva;
  }

  get puedeCambiarClave(): boolean {
    return !!this.claveActual && !!this.claveNueva && !this.errorClaveNueva
      && this.claveRepetida === this.claveNueva && !this.guardandoClave;
  }

  async cambiarClave() {
    if (!this.puedeCambiarClave) return;
    this.guardandoClave = true;
    this.mensajeClave = null;
    try {
      await this.miCuenta.cambiarClave(this.claveActual, this.claveNueva);
      this.claveActual = this.claveNueva = this.claveRepetida = '';
      this.verClaves = false;
      this.mensajeClave = { ok: true, texto: 'Listo: tu contraseña se cambió. La próxima vez entrá con la nueva.' };
    } catch (err: any) {
      console.error(err);
      this.mensajeClave = { ok: false, texto: err instanceof MiCuentaError ? err.message : 'No se pudo cambiar la contraseña. Probá de nuevo.' };
    } finally {
      this.guardandoClave = false;
    }
  }
}
