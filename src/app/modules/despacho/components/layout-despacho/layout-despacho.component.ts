import { Component, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { Firestore, collection, query, where, getDocs, getDoc, doc, runTransaction } from '@angular/fire/firestore';
import Swal from 'sweetalert2';
import { ProductosCacheService } from '../../services/productos-cache.service';
import { CajaService, ResumenCaja, CierreCajaError } from '../../services/caja.service';
import { InformeCierreService } from '../../services/informe-cierre.service';
import { TicketsService } from '../../services/tickets.service';
import { CobroReparacionesService, CobroReparacionError } from '../../services/cobro-reparaciones.service';
import {
  METODOS_PAGO, MetodoPago, LineaPago, PagoVenta, calcularPagos, metodoResumen, nombreMetodo, textoPagos
} from '../../services/pagos';
import {
  MovimientosCajaService, MovimientoCaja, MovimientoCajaError, TipoMovimientoCaja,
  TIPOS_MOVIMIENTO, nombreTipoMovimiento, signoMovimiento
} from '../../services/movimientos-caja.service';
import { AbrirCajaDialogComponent } from '../abrir-caja-dialog/abrir-caja-dialog.component';
import { MatDialog } from '@angular/material/dialog';
import { SucursalesService } from 'src/app/modules/admin/services/sucursales.service'; 
import { firstValueFrom, Subscription } from 'rxjs';
import { Sucursal } from 'src/app/modules/admin/models/sucursal.model';
import { FormControl } from '@angular/forms';
import { VouchersPuntosService } from 'src/app/shared/services/vouchers-puntos.service';
import { GeneralService } from 'src/app/shared/services/general.service';
import { InfoEmpresa } from 'src/app/shared/models/infoEmpresa.model';
import { InfoEmpresaService } from 'src/app/shared/services/info-empresa.service';
import { AuditoriaService, UsuarioRegistro } from 'src/app/shared/services/auditoria.service';
import { BuscadorClientesService, ClienteEncontrado } from 'src/app/shared/services/buscador-clientes.service';

interface ClientePOS {
  id: string;
  dni: string;
  nombre: string;
  tipo: 'minorista' | 'mayorista';
  puntos: number;
}

interface ProductoPOS {
  id: string;
  codigoBarras: string;
  descripcion: string;
  precioMinorista: number;
  precioMayorista: number;
}

interface ItemCarritoPOS {
  productoId: string;
  nombre: string;
  cantidad: number;
  precioUnitario: number; // editable
  subtotal: number;
  stockDisponible: number; // stock al momento de agregarlo (según lista de precios y sucursal)
}

/** Error de negocio cuando no alcanza el stock al confirmar la venta */
class StockInsuficienteError extends Error {
  constructor(public faltantes: { productoId: string; nombre: string; disponible: number; solicitado: number }[]) {
    super('STOCK_INSUFICIENTE');
  }
}

/** Error de negocio con mensaje para mostrar al vendedor */
class VentaError extends Error {
  constructor(message: string) {
    super(message);
  }
}

/**
 * Resumen de importes de la venta.
 * REGLA: precio minorista → puede tener descuentos (cupón, puntos, efectivo/transferencia).
 *        precio mayorista → SIN ningún descuento.
 */
interface ResumenVenta {
  subtotal: number;
  aplicaDescuentos: boolean;
  descuentoCupon: number;
  puntosUsados: number;
  descuentoPuntos: number;
  totalBase: number;          // después de cupón y puntos
  porcentajePago: number;     // % por efectivo/transferencia (si paga con un solo medio)
  descuentoPago: number;      // suma de los descuentos por medio de pago
  pagos: PagoVenta[];         // cuánto paga con cada medio (uno o varios)
  errorPago: string | null;   // pagos incompletos o inválidos
  totalFinal: number;         // lo que efectivamente paga
  puntosASumar: number;
}

@Component({
  selector: 'app-layout-despacho',
  templateUrl: './layout-despacho.component.html',
  styleUrls: ['./layout-despacho.component.css']
})
export class LayoutDespachoComponent implements OnInit, OnDestroy {

  // Sucursales
  sucursales: Sucursal[] = [];
  private sucursalesSub?: Subscription;

  // Sucursal / caja seleccionada
  selectedSucursal: Sucursal | null = null;
  cajaActiva: any = null;

  // Array de productos para búsqueda manual
  productosFiltrados: ProductoPOS[] = [];

  // Cliente
  clienteActual: ClientePOS | null = null;
  tipoPrecio: 'minorista' | 'mayorista' = 'minorista';
  precioForzadoManualmente = false;
  recalculandoPrecios = false;
  procesandoVenta = false;

  // ===== Cierre de caja =====
  mostrarCierre = false;
  cajaACerrar: any = null;              // caja que se está cerrando (la activa o una vieja sin cerrar)
  nombreSucursalCierre = '';
  resumenCierre: ResumenCaja | null = null;
  calculandoCierre = false;
  cerrandoCaja = false;
  efectivoContado: number | null = null;
  observacionCierre = '';
  usarContadorBilletes = false;
  readonly denominaciones = [20000, 10000, 2000, 1000, 500, 200, 100, 50, 20, 10];
  billetes: { [denominacion: string]: number } = {};
  monedas: number | null = null;
  private sucursalPendiente: Sucursal | null = null; // para seguir con la apertura después de cerrar una caja vieja

  // ===== Movimientos de caja =====
  readonly tiposMovimiento = TIPOS_MOVIMIENTO;
  mostrarMovimientos = false;
  movimientos: MovimientoCaja[] = [];
  cargandoMovimientos = false;
  guardandoMovimiento = false;
  movTipo: TipoMovimientoCaja = 'retiro';
  movImporte: number | null = null;
  movMotivo = '';
  movProveedor = '';
  movObservaciones = '';
  movCorrigiendo: MovimientoCaja | null = null;   // movimiento anulado que se está corrigiendo

  @ViewChild('dniInput') dniInput?: ElementRef<HTMLInputElement>;
  buscandoCliente = false;
  busquedaRealizada = false;

  // Búsqueda de cliente por nombre / apellido (lista mientras se escribe)
  sugerenciasClientes: ClienteEncontrado[] = [];
  buscandoSugerencias = false;
  private textoSugerencias = '';
  readonly etiquetaCliente = BuscadorClientesService.etiqueta;

  // Cache de productos
  productoCache: { [codigo: string]: ProductoPOS } = {};

  // Carrito
  carrito: ItemCarritoPOS[] = [];
  total: number = 0;

  // Control búsqueda manual
  modoBusquedaManual: boolean = false;
  busquedaManual: string = '';

  /** Medios de pago de la venta. El monto del último se calcula solo (es el resto). */
  readonly metodosPago = METODOS_PAGO;
  lineasPago: LineaPago[] = [{ metodo: null, monto: null }];
  mostrarErrorPago = false;

  loadingInicial = false;

  cuponControl = new FormControl('');
  cuponAplicado: any = null;
  mensajeCupon: string = '';
  errorCupon: string = '';
  cuponInvalido: boolean = false;

  usarPuntos: boolean = false;
  puntosAplicados: number = 0;
  valorMonetarioPorPunto: number = 50;
  valorParaSumarPunto: number = 200;
  montoParaActivar: number = 50000; // Monto mínimo para activar el modo mayorista

  descuentoEfectivo: number = 0;
  descuentoTransferencia: number = 0;
  descuentoAplicado: number = 0;

  dolar: number = 1;
  

  constructor(
    private firestore: Firestore,
    private productosCache: ProductosCacheService,
    private cajaService: CajaService,
    private informeCierre: InformeCierreService,
    private tickets: TicketsService,
    private cobroReparaciones: CobroReparacionesService,
    private movimientosCaja: MovimientosCajaService,
    private dialog: MatDialog,
    private sucursalesService: SucursalesService,
    private puntosService: VouchersPuntosService,
    public generalService: GeneralService,
    public infoEmpresaService: InfoEmpresaService,
    private auditoria: AuditoriaService,
    private buscadorClientes: BuscadorClientesService
  ) { }


async ngOnInit() {
  this.loadingInicial = true;
  try {
    // 1) sincronizo cache de productos
    await this.productosCache.syncProductos();

    // 2) traigo las sucursales UNA VEZ (sin suscripción continua)
    const lista = await firstValueFrom(this.sucursalesService.obtenerSucursales());
    this.sucursales = lista || [];

  } catch (err) {
    console.error('Error inicializando POS:', err);
    Swal.fire('Error', 'No se pudieron cargar los datos iniciales. ' + (err as any)?.message, 'error');
  } finally {
    this.loadingInicial = false;
  }
    await this.inicializarValoresPuntos();
    this.cuponControl.valueChanges.subscribe(() => {
      if (this.cuponInvalido) {
        this.cuponInvalido = false;
        this.mensajeCupon = '';
      }
    });

    this.infoEmpresaService.obtenerInfoGeneral().subscribe((info: InfoEmpresa | null) => {
      if (info) {
        this.descuentoEfectivo = info.descuentoEnEfectivo || 0;
        this.descuentoTransferencia = info.descuentoEnTransferencia || 0;
        this.dolar = info.dolar;
      }
    });  
    
}

  async inicializarValoresPuntos() {
    const valores = await this.puntosService.obtenerValoresPuntos();
    if (valores) {
      this.valorParaSumarPunto = valores.valorParaSumarPunto;
      this.valorMonetarioPorPunto = valores.valorMonetarioPorPunto;
    }
    
    this.puntosAplicados = this.getPuntosAplicados(this.carrito);

    const valoresMayoristas = await this.puntosService.obtenerMontosMayoristas();
    if (valoresMayoristas) {
      this.montoParaActivar = valoresMayoristas.minimoPrimeraCompra;
    } 

  }

  getPuntosAplicados(_carrito?: any): number {
    return this.calcularResumen().puntosUsados;
  }

  ngOnDestroy() {
    document.body.classList.remove('tickets-abierto');
    
  }


    aplicarCupon() {
    const codigo = this.cuponControl.value?.trim();
    if (!codigo) return;

    if (!this.aplicanDescuentos) {
      this.cuponInvalido = true;
      this.mensajeCupon = 'Los cupones no aplican a precios mayoristas';
      return;
    }

    this.puntosService.obtenerCuponPorCodigo(codigo).then((cupon) => {
      if (cupon && (cupon.cantidadDisponible ?? 1) > 0) {
        this.cuponAplicado = cupon;
        this.cuponInvalido = false;
        this.mensajeCupon = '';
        this.cuponControl.disable(); // Deshabilitamos si es válido
      } else {
        this.cuponAplicado = null;
        this.cuponInvalido = true;
        this.mensajeCupon = 'Cupón inválido o no disponible ❌';
      }
    });
  }

  eliminarCupon() {
    this.cuponAplicado = null;
    this.errorCupon = '';
    this.cuponControl.enable();
    this.cuponControl.setValue('');
  }


  /** ---------------------
   * Selección de sucursal
   * --------------------- */
async seleccionarSucursal(sucursal: Sucursal) {
  // Mostrar un estado de carga si querés (opcional)
  // this.loadingSeleccion = true;

  // 0) ¿Quedó una caja de un día anterior sin cerrar? Hay que cerrarla primero.
  try {
    const sinCerrar = await this.cajaService.buscarCajasSinCerrar(sucursal.id);
    if (sinCerrar.length) {
      const vieja = sinCerrar[0];
      const fecha = new Date(vieja.fechaApertura).toLocaleDateString('es-AR');
      const quien = vieja.usuario?.nombre || vieja.usuario?.usuario || '';
      const r = await Swal.fire({
        title: 'Caja sin cerrar',
        html: `La caja del <strong>${fecha}</strong>${quien ? ` (abierta por ${quien})` : ''} quedó sin cerrar.<br>Hay que cerrarla antes de abrir la de hoy.`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Cerrarla ahora',
        cancelButtonText: 'Cancelar'
      });
      if (r.isConfirmed) {
        this.sucursalPendiente = sucursal;
        await this.iniciarCierre(vieja, sucursal);
      }
      return;
    }
  } catch (err) {
    console.warn('No se pudo verificar cajas sin cerrar:', err);
  }

  try {
    // 1) consulto Firestore por una caja abierta HOY para esa sucursal
    const cajaFirestore = await this.cajaService.verificarCajaAbierta(sucursal.id);
    if (cajaFirestore) {
      // sólo ahora seteamos la sucursal seleccionada y guardamos preferencia
      this.selectedSucursal = sucursal;
      this.cajaActiva = cajaFirestore;
      localStorage.setItem('sucursalSeleccionada', sucursal.id);
      return;
    }
  } catch (err) {
    console.warn('Error verificando caja en Firestore:', err);
    // seguimos al fallback
  }

  // 2) fallback local (sólo si la caja local es válida y corresponde a la misma sucursal)
  const cajaLocal = (typeof this.cajaService.getCajaActivaLocalValidada === 'function')
    ? this.cajaService.getCajaActivaLocalValidada()
    : (this.cajaService.getCajaActiva ? this.cajaService.getCajaActiva() : null);

  if (cajaLocal && cajaLocal.sucursalId === sucursal.id) {
    // la caja local es válida (de hoy) -> aceptamos selección
    this.selectedSucursal = sucursal;
    this.cajaActiva = cajaLocal;
    localStorage.setItem('sucursalSeleccionada', sucursal.id);
    return;
  }

  // 3) No hay caja válida: forzamos apertura de caja antes de permitir facturar
  const result = await Swal.fire({
    title: '🚨 Caja no abierta',
    text: 'Debes abrir la caja para esta sucursal antes de registrar ventas.',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Abrir caja',
    cancelButtonText: 'Cancelar'
  });

  if (result.isConfirmed) {
    // abrirCaja abrirá el diálogo y si la apertura es exitosa pondrá la caja en localStorage
    this.abrirCaja(sucursal.id);
  } else {
    // si cancela, no seleccionamos nada (seguimos mostrando cards)
    this.selectedSucursal = null;
    this.cajaActiva = null;
    // y no tocamos localStorage.sucursalSeleccionada
  }

}


  /** Abrir caja: abre el diálogo y luego sincroniza la caja recién creada */
abrirCaja(sucursalIdExistente?: string) {
  const dialogRef = this.dialog.open(AbrirCajaDialogComponent, {
    width: '400px',
    data: { sucursalId: sucursalIdExistente }
  });

  dialogRef.afterClosed().subscribe(async result => {
    if (result) {
      try {
        // Usuario que inició sesión (antes se guardaba siempre 'usuario123')
        const usuario = this.auditoria.getUsuarioActual();

        // Crear caja en Firestore (guarda fecha como Timestamp dentro del service)
        const nuevaCaja = await this.cajaService.abrirCaja(result.sucursalId, usuario, result.montoInicial);

        // Guardamos la sucursal seleccionada SÓLO si la apertura tuvo éxito
        localStorage.setItem('sucursalSeleccionada', result.sucursalId);

        // sincronizamos la cajaActiva en memoria para el componente
        // si tu servicio ya dejó la caja en localStorage, la podemos leer:
        const cajaVal = (typeof this.cajaService.getCajaActivaLocalValidada === 'function')
          ? this.cajaService.getCajaActivaLocalValidada()
          : this.cajaService.getCajaActiva && this.cajaService.getCajaActiva();

        this.cajaActiva = cajaVal || nuevaCaja;
        // y setear la sucursal seleccionada en UI
        const suc = this.sucursales.find(x => x.id === result.sucursalId);
        if (suc) this.selectedSucursal = suc;

        Swal.fire('✅ Caja abierta correctamente', '', 'success');
      } catch (err: any) {
        Swal.fire('⚠️ Error', err?.message || 'Error al abrir caja', 'error');
      }
    } else {
      // usuario canceló el diálogo: no hacemos nada (no guardamos sucursal)
    }
  });
}


  /** Volver a elegir sucursal (cancela selección actual) */
  // =====================================================
  // 💵 MOVIMIENTOS DE CAJA
  // =====================================================

  nombreTipo(tipo: string): string {
    return nombreTipoMovimiento(tipo);
  }

  signo(tipo: string): number {
    return signoMovimiento(tipo);
  }

  get ayudaTipo(): string {
    return this.tiposMovimiento.find(t => t.valor === this.movTipo)?.ayuda || '';
  }

  async abrirMovimientos() {
    if (!this.cajaActiva) return;
    this.limpiarFormMovimiento();
    this.mostrarMovimientos = true;
    await this.cargarMovimientos();
  }

  cerrarMovimientos() {
    if (this.guardandoMovimiento) return;
    this.mostrarMovimientos = false;
    this.movCorrigiendo = null;
  }

  async cargarMovimientos() {
    if (!this.cajaActiva) return;
    this.cargandoMovimientos = true;
    try {
      this.movimientos = await this.movimientosCaja.listarPorCaja(this.cajaActiva.id);
    } catch (err) {
      console.error('Error cargando movimientos:', err);
      this.movimientos = [];
    } finally {
      this.cargandoMovimientos = false;
    }
  }

  /** Neto de efectivo de los movimientos vigentes (+ ingresos, − egresos) */
  get netoMovimientos(): number {
    return this.movimientos
      .filter(m => !m.anulado)
      .reduce((acc, m) => acc + this.signo(m.tipo) * (Number(m.importe) || 0), 0);
  }

  private limpiarFormMovimiento() {
    this.movTipo = 'retiro';
    this.movImporte = null;
    this.movMotivo = '';
    this.movProveedor = '';
    this.movObservaciones = '';
    this.movCorrigiendo = null;
  }

  get movimientoValido(): boolean {
    return Number(this.movImporte) > 0
      && this.movMotivo.trim().length >= 3
      && (this.movTipo !== 'proveedor' || this.movProveedor.trim().length > 0);
  }

  async guardarMovimiento() {
    if (!this.cajaActiva || !this.movimientoValido || this.guardandoMovimiento) return;

    const importe = Number(this.movImporte);
    const r = await Swal.fire({
      title: 'Confirmar movimiento',
      html: `<strong>${this.nombreTipo(this.movTipo)}</strong><br>
             <span style="font-size:22px">${this.formatearMoneda(importe)}</span><br>
             ${this.movMotivo}${this.movCorrigiendo ? '<br><small>(corrige un movimiento anulado)</small>' : ''}`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Registrar',
      cancelButtonText: 'Volver'
    });
    if (!r.isConfirmed) return;

    this.guardandoMovimiento = true;
    try {
      const mov = await this.movimientosCaja.registrar(this.cajaActiva, {
        tipo: this.movTipo,
        importe,
        motivo: this.movMotivo,
        proveedor: this.movProveedor,
        observaciones: this.movObservaciones
      }, this.movCorrigiendo);

      this.limpiarFormMovimiento();
      await this.cargarMovimientos();

      // En retiros, pagos y depósitos conviene imprimir el comprobante para firmar
      if (mov.tipo !== 'ingreso') {
        const imp = await Swal.fire({
          title: 'Movimiento registrado',
          text: '¿Imprimir comprobante para firmar?',
          icon: 'success',
          showCancelButton: true,
          confirmButtonText: 'Imprimir',
          cancelButtonText: 'No'
        });
        if (imp.isConfirmed) this.imprimirMovimiento(mov);
      } else {
        Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Movimiento registrado', showConfirmButton: false, timer: 2000 });
      }
    } catch (err: any) {
      this.manejarErrorMovimiento(err);
    } finally {
      this.guardandoMovimiento = false;
    }
  }

  /** Anular un movimiento mal cargado (no se borra) */
  async anularMovimiento(mov: MovimientoCaja, paraCorregir = false): Promise<boolean> {
    if (!this.cajaActiva || mov.anulado) return false;

    const r = await Swal.fire({
      title: paraCorregir ? 'Corregir movimiento' : '¿Anular movimiento?',
      html: `${this.nombreTipo(mov.tipo)} de <strong>${this.formatearMoneda(mov.importe)}</strong><br>${mov.motivo}<br><br>
             <small>${paraCorregir
               ? 'El movimiento se anula y después cargás el correcto.'
               : 'El movimiento no se borra: queda registrado como anulado.'}</small>`,
      icon: 'warning',
      input: 'text',
      inputLabel: 'Motivo',
      inputPlaceholder: paraCorregir ? 'Ej: importe mal cargado' : 'Ej: cargado dos veces',
      inputValidator: (v: string) => (!v || v.trim().length < 3) ? 'Ingresá un motivo' : null,
      showCancelButton: true,
      confirmButtonText: paraCorregir ? 'Anular y corregir' : 'Anular',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#d33'
    });
    if (!r.isConfirmed) return false;

    try {
      await this.movimientosCaja.anular(this.cajaActiva, mov, r.value);
      await this.cargarMovimientos();
      return true;
    } catch (err: any) {
      this.manejarErrorMovimiento(err);
      return false;
    }
  }

  /** Corrección = anular el movimiento y cargar el correcto (con los datos precargados) */
  async corregirMovimiento(mov: MovimientoCaja) {
    const anulado = await this.anularMovimiento(mov, true);
    if (!anulado) return;
    this.movTipo = mov.tipo;
    this.movImporte = mov.importe;
    this.movMotivo = mov.motivo;
    this.movProveedor = mov.proveedor || '';
    this.movObservaciones = mov.observaciones || '';
    this.movCorrigiendo = { ...mov, anulado: true };
  }

  imprimirMovimiento(mov: MovimientoCaja) {
    this.movimientosCaja.imprimirComprobante(mov, this.selectedSucursal?.nombre || '');
  }

  private manejarErrorMovimiento(err: any) {
    if (err instanceof MovimientoCajaError) {
      Swal.fire('No se pudo completar', err.message, 'warning');
      if (err.message.startsWith('La caja está cerrada')) {
        this.mostrarMovimientos = false;
        this.cajaService.clearCajaActiva();
        this.cajaActiva = null;
        this.selectedSucursal = null;
      }
    } else {
      console.error('Error en movimiento de caja:', err);
      Swal.fire('Error', 'No se pudo registrar el movimiento. ' + (err?.message || ''), 'error');
    }
  }

  // =====================================================
  // 🔒 CIERRE DE CAJA
  // =====================================================

  /** Abre la ventana de cierre (de la caja activa o de una caja vieja sin cerrar) */
  async iniciarCierre(caja: any = this.cajaActiva, sucursal: Sucursal | null = this.selectedSucursal) {
    if (!caja) return;

    if (caja === this.cajaActiva && this.carrito.length > 0) {
      const r = await Swal.fire({
        title: 'Hay una venta en curso',
        text: 'El carrito tiene productos sin vender. Si cerrás la caja, se descartan.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Descartar y cerrar',
        cancelButtonText: 'Volver'
      });
      if (!r.isConfirmed) return;
    }

    this.cajaACerrar = caja;
    this.nombreSucursalCierre = sucursal?.nombre
      || this.sucursales.find(x => x.id === caja.sucursalId)?.nombre
      || '';
    this.efectivoContado = null;
    this.observacionCierre = '';
    this.usarContadorBilletes = false;
    this.billetes = {};
    this.monedas = null;
    this.mostrarCierre = true;

    await this.calcularResumenCierre();
  }

  async calcularResumenCierre() {
    if (!this.cajaACerrar) return;
    this.calculandoCierre = true;
    try {
      this.resumenCierre = await this.cajaService.obtenerResumen(this.cajaACerrar);
    } catch (err: any) {
      console.error('Error calculando cierre:', err);
      Swal.fire('Error', 'No se pudieron calcular los totales de la caja. ' + (err?.message || ''), 'error');
      this.mostrarCierre = false;
    } finally {
      this.calculandoCierre = false;
    }
  }

  /** Total del contador de billetes */
  get totalBilletes(): number {
    const enBilletes = this.denominaciones.reduce(
      (acc, den) => acc + den * (Math.max(0, Math.floor(Number(this.billetes[den]) || 0))), 0);
    return enBilletes + Math.max(0, Number(this.monedas) || 0);
  }

  actualizarDesdeBilletes() {
    if (this.usarContadorBilletes) {
      this.efectivoContado = this.totalBilletes;
    }
  }

  get diferenciaCierre(): number | null {
    if (!this.resumenCierre || this.efectivoContado === null || this.efectivoContado === undefined || (this.efectivoContado as any) === '') {
      return null;
    }
    return Math.round(((Number(this.efectivoContado) || 0) - this.resumenCierre.efectivoEsperado) * 100) / 100;
  }

  /** Con diferencia, la observación es obligatoria */
  get cierreValido(): boolean {
    const dif = this.diferenciaCierre;
    if (dif === null || Number(this.efectivoContado) < 0) return false;
    if (Math.abs(dif) >= 0.01 && this.observacionCierre.trim().length < 3) return false;
    return true;
  }

  cancelarCierre() {
    if (this.cerrandoCaja) return;
    this.sucursalPendiente = null;
    this.mostrarCierre = false;
    this.cajaACerrar = null;
    this.resumenCierre = null;
  }

  async confirmarCierre() {
    if (!this.cajaACerrar || !this.resumenCierre || !this.cierreValido || this.cerrandoCaja) return;

    const dif = this.diferenciaCierre as number;
    const textoDif = Math.abs(dif) < 0.01
      ? '<strong>Sin diferencias</strong>'
      : `<strong style="color:${dif > 0 ? '#0a7' : '#d33'}">${dif > 0 ? 'Sobrante' : 'Faltante'} de ${this.formatearMoneda(Math.abs(dif))}</strong>`;

    const r = await Swal.fire({
      title: '¿Cerrar la caja?',
      html: `Efectivo esperado: ${this.formatearMoneda(this.resumenCierre.efectivoEsperado)}<br>
             Efectivo contado: ${this.formatearMoneda(Number(this.efectivoContado))}<br><br>${textoDif}
             <br><br><small>Una vez cerrada, la caja no se puede modificar.</small>`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Cerrar caja',
      cancelButtonText: 'Volver'
    });
    if (!r.isConfirmed) return;

    this.cerrandoCaja = true;
    try {
      const detalle = this.usarContadorBilletes
        ? { ...Object.fromEntries(this.denominaciones.map(d => [String(d), Math.floor(Number(this.billetes[d]) || 0)])), monedas: Number(this.monedas) || 0 }
        : null;

      const cerrada = await this.cajaService.cerrarCaja(
        this.cajaACerrar,
        this.resumenCierre,
        Number(this.efectivoContado),
        this.observacionCierre,
        detalle
      );

      const nombreSucursal = this.nombreSucursalCierre;
      const eraLaActiva = this.cajaActiva?.id === cerrada.id;

      this.mostrarCierre = false;
      this.cajaACerrar = null;
      this.resumenCierre = null;

      if (eraLaActiva) {
        this.carrito = [];
        this.total = 0;
        this.cajaActiva = null;
        this.selectedSucursal = null;
        localStorage.removeItem('sucursalSeleccionada');
      }

      const res = await Swal.fire({
        title: '✅ Caja cerrada',
        text: '¿Querés imprimir el informe de cierre?',
        icon: 'success',
        showDenyButton: true,
        showCancelButton: true,
        confirmButtonText: 'Ticket 80 mm',
        denyButtonText: 'Hoja A4 / PDF',
        cancelButtonText: 'No imprimir'
      });
      if (res.isConfirmed) this.informeCierre.abrir(cerrada, nombreSucursal, 'ticket');
      if (res.isDenied) this.informeCierre.abrir(cerrada, nombreSucursal, 'a4');

      // Si se cerró una caja vieja al elegir la sucursal, seguimos con la apertura de hoy
      if (!eraLaActiva && this.sucursalPendiente) {
        const suc = this.sucursalPendiente;
        this.sucursalPendiente = null;
        await this.seleccionarSucursal(suc);
      }

    } catch (err: any) {
      if (err instanceof CierreCajaError) {
        await Swal.fire('No se pudo cerrar la caja', err.message, 'warning');
        if (err.message.startsWith('Se registró una venta') || err.message.startsWith('Se registró un movimiento')) {
          await this.calcularResumenCierre();
        }
        if (err.message.startsWith('Esta caja ya fue cerrada')) {
          this.mostrarCierre = false;
          if (this.cajaActiva?.id === this.cajaACerrar?.id) {
            this.cajaService.clearCajaActiva();
            this.cajaActiva = null;
            this.selectedSucursal = null;
          }
        }
      } else {
        console.error('Error cerrando caja:', err);
        await Swal.fire('Error', 'No se pudo cerrar la caja. ' + (err?.message || ''), 'error');
      }
    } finally {
      this.cerrandoCaja = false;
    }
  }

  cambiarSucursal() {
    this.selectedSucursal = null;
    this.cajaActiva = null;
    localStorage.removeItem('sucursalSeleccionada');
    this.cajaService.clearCajaActiva();
  }

  /**
   * Buscar cliente: por DNI (número exacto) o por nombre / apellido.
   * Con texto, si hay una sola coincidencia la elige; si hay varias muestra la lista.
   */
  async buscarClientePorDNI(texto: string) {
    const valor = (texto || '').trim();
    if (!valor) return;

    if (!/^\d+$/.test(valor)) {
      const lista = await this.buscarSugerencias(valor, true);
      if (lista.length === 1) {
        this.seleccionarCliente(lista[0]);
      } else if (!lista.length) {
        this.clienteActual = null;
        this.busquedaRealizada = true;
        await this.cambiarListaDePrecios('minorista');
      }
      return;
    }

    this.buscandoCliente = true;
    this.busquedaRealizada = false;
    this.clienteActual = null;
    this.usarPuntos = false;
    this.sugerenciasClientes = [];

    try {
      const dniCliente = parseInt(valor, 10);
      const clientesRef = collection(this.firestore, 'Clientes');
      const q = query(clientesRef, where('dni', '==', dniCliente));
      const snap = await getDocs(q);

      if (!snap.empty) {
        const docu = snap.docs[0];
        await this.aplicarCliente(docu.id, docu.data());
      } else {
        this.clienteActual = null;
        await this.cambiarListaDePrecios('minorista');
      }
    } catch (error) {
      console.error('Error buscando cliente:', error);
    } finally {
      this.buscandoCliente = false;
      this.busquedaRealizada = true;
    }
  }

  /** Mientras escribe: lista de clientes que coinciden (desde 3 letras) */
  async alEscribirCliente(texto: string) {
    const valor = (texto || '').trim();
    this.busquedaRealizada = false;
    if (valor.length < 3) {
      this.sugerenciasClientes = [];
      return;
    }
    await this.buscarSugerencias(valor, false);
  }

  private async buscarSugerencias(valor: string, mostrarVacio: boolean): Promise<ClienteEncontrado[]> {
    this.textoSugerencias = valor;
    this.buscandoSugerencias = true;
    try {
      const lista = await this.buscadorClientes.buscar(valor, 8);
      // Si mientras tanto siguió escribiendo, esta respuesta ya no sirve
      if (this.textoSugerencias !== valor) return lista;
      this.sugerenciasClientes = lista;
      if (mostrarVacio && !lista.length) this.busquedaRealizada = true;
      return lista;
    } catch (e) {
      console.error('Error buscando clientes:', e);
      return [];
    } finally {
      this.buscandoSugerencias = false;
    }
  }

  async seleccionarCliente(c: ClienteEncontrado) {
    this.sugerenciasClientes = [];
    this.textoSugerencias = '';
    this.usarPuntos = false;
    if (this.dniInput) this.dniInput.nativeElement.value = String(c.dni || c.cuit || '');
    await this.aplicarCliente(c.id, c.data);
    this.busquedaRealizada = true;
  }

  cerrarSugerencias() {
    // Pequeña demora para que llegue el click sobre la lista
    setTimeout(() => this.sugerenciasClientes = [], 200);
  }

  /** Deja al cliente como cliente de la venta y fija su lista de precios */
  private async aplicarCliente(id: string, data: any) {
    const catCliente: 'mayorista' | 'minorista' = data.esMayorista ? 'mayorista' : 'minorista';
    this.clienteActual = {
      id,
      dni: data.dni,
      nombre: [data.nombre, data.apellido].filter(Boolean).join(' ') || data.razonSocial || 'Cliente',
      tipo: catCliente,
      puntos: data.puntos || 0
    };
    await this.cambiarListaDePrecios(this.clienteActual.tipo);
  }

  async procesarCodigoBarras(codigo: string) {
    const producto = await this.productosCache.getProductoPorCodigo(codigo);

    if (producto) {
      await this.agregarAlCarrito(producto);
      this.modoBusquedaManual = false;
    } else {
      this.modoBusquedaManual = true;
      this.busquedaManual = '';
      this.productosFiltrados = [];
    }
  }

  // =====================================================
  // 📦 STOCK
  // =====================================================

  /** Normaliza stockSucursales (estructura vieja tipo mapa → array) */
  private normalizarStockSucursales(stockSucursales: any): { sucursalId: string; cantidad: number }[] {
    if (!stockSucursales) return [];
    if (Array.isArray(stockSucursales)) {
      return stockSucursales.map((s: any) => ({ sucursalId: s.sucursalId, cantidad: Number(s.cantidad) || 0 }));
    }
    return Object.entries(stockSucursales).map(([sucursalId, cantidad]) => ({
      sucursalId,
      cantidad: Number(cantidad) || 0
    }));
  }

  /** Sucursal desde la que se está vendiendo */
  private get sucursalIdActual(): string | null {
    return this.cajaActiva?.sucursalId || this.selectedSucursal?.id || null;
  }

  /**
   * Stock disponible para vender según la lista de precios:
   * - mayorista → stockMayorista
   * - minorista → stock de la sucursal donde está abierta la caja
   */
  getStockDisponible(producto: any, tipo: 'minorista' | 'mayorista' = this.tipoPrecio): number {
    if (!producto) return 0;
    if (tipo === 'mayorista') {
      return Math.max(0, Number(producto.stockMayorista) || 0);
    }
    const sucursalId = this.sucursalIdActual;
    if (!sucursalId) return 0;
    const entrada = this.normalizarStockSucursales(producto.stockSucursales)
      .find(s => s.sucursalId === sucursalId);
    return entrada ? Math.max(0, entrada.cantidad) : 0;
  }

  /** Trae el producto actualizado desde Firestore (si falla, usa el de la cache local) */
  private async obtenerProductoActualizado(producto: any): Promise<any> {
    try {
      const snap = await getDoc(doc(this.firestore, 'productos', producto.id));
      if (snap.exists()) {
        const actualizado = { id: snap.id, ...snap.data() } as any;
        actualizado.stockSucursales = this.normalizarStockSucursales(actualizado.stockSucursales);
        await this.productosCache.actualizarProducto(actualizado);
        return actualizado;
      }
    } catch (err) {
      console.warn('No se pudo consultar stock online, se usa la cache local:', err);
    }
    return producto;
  }

  private avisarSinStock(nombre: string, disponible: number, solicitado?: number) {
    const lista = this.tipoPrecio === 'mayorista' ? 'mayorista' : `la sucursal ${this.selectedSucursal?.nombre || ''}`.trim();
    const detalle = disponible <= 0
      ? `No hay stock de <strong>${nombre}</strong> en ${lista}.`
      : `Solo hay <strong>${disponible}</strong> unidad(es) de <strong>${nombre}</strong> en ${lista}` +
        (solicitado ? ` (intentaste vender ${solicitado}).` : '.');
    Swal.fire({ title: '📦 Sin stock suficiente', html: detalle, icon: 'warning' });
  }

  /** Precio en ARS de un producto según la lista (minorista/mayorista) */
  private calcularPrecioPOS(producto: any, tipo: 'minorista' | 'mayorista' = this.tipoPrecio): number {
    const precioBase = tipo === 'minorista' ? producto.precioMinorista : producto.precioMayorista;
    let precioEnPesos = Number(precioBase) || 0;
    if (producto.moneda === 'USD') {
      precioEnPesos *= this.dolar;
    }
    return precioEnPesos;
  }

  /** Busca un producto por id (Firestore actualizado, o la cache local si no hay conexión) */
  private async obtenerProductoPorId(id: string): Promise<any | null> {
    const productosLocales = await this.productosCache.getProductos();
    const local = productosLocales.find((p: any) => p.id === id);
    const actualizado = await this.obtenerProductoActualizado(local || { id });
    // Si no hay datos de precio (ni online ni en cache) devolvemos null
    const tieneDatos = actualizado && (actualizado.precioMinorista != null || actualizado.precioMayorista != null);
    return tieneDatos ? actualizado : null;
  }

  /**
   * Cambia la lista de precios y recalcula TODO el carrito:
   * precios (los editados a mano se pisan) y stock disponible según la nueva lista.
   */
  private async cambiarListaDePrecios(nuevoTipo: 'minorista' | 'mayorista') {
    if (nuevoTipo === this.tipoPrecio) return;
    this.tipoPrecio = nuevoTipo;

    // Precio mayorista = sin descuentos
    if (nuevoTipo === 'mayorista') {
      this.usarPuntos = false;
      if (this.cuponAplicado) this.eliminarCupon();
    }

    if (this.carrito.length === 0) return;

    this.recalculandoPrecios = true;
    const sinStock: string[] = [];

    try {
      for (const item of this.carrito) {
        const producto = await this.obtenerProductoPorId(item.productoId);
        if (!producto) continue; // sin datos: dejamos el ítem como está

        item.precioUnitario = this.calcularPrecioPOS(producto, nuevoTipo);
        item.stockDisponible = this.getStockDisponible(producto, nuevoTipo);
        item.subtotal = item.precioUnitario * item.cantidad;

        if (item.cantidad > item.stockDisponible) {
          sinStock.push(`${item.nombre} (pedido ${item.cantidad}, disponible ${item.stockDisponible})`);
        }
      }

      this.calcularTotal();

      const lista = nuevoTipo === 'mayorista' ? 'MAYORISTA' : 'MINORISTA';
      if (sinStock.length) {
        await Swal.fire({
          title: `Lista ${lista} aplicada`,
          html: `Se actualizaron los precios del carrito.<br><br>⚠️ Sin stock suficiente en esta lista:<ul style="text-align:left">${sinStock.map(x => `<li>${x}</li>`).join('')}</ul>Ajustá las cantidades antes de finalizar.`,
          icon: 'warning'
        });
      } else {
        Swal.fire({
          toast: true,
          position: 'top-end',
          icon: 'success',
          title: `Precios actualizados a lista ${lista}`,
          showConfirmButton: false,
          timer: 2500
        });
      }
    } finally {
      this.recalculandoPrecios = false;
    }
  }

  async agregarAlCarrito(
    producto: any,
    desdeBusquedaManual: boolean = false
  ) {
    if (this.recalculandoPrecios) return;

    // 📦 Verificamos stock con el dato más fresco posible
    producto = await this.obtenerProductoActualizado(producto);
    const stockDisponible = this.getStockDisponible(producto);

    const existente = this.carrito.find(item => item.productoId === producto.id);
    const cantidadSolicitada = (existente?.cantidad || 0) + 1;

    if (cantidadSolicitada > stockDisponible) {
      this.avisarSinStock(producto.descripcion, stockDisponible, existente ? cantidadSolicitada : undefined);
      return;
    }

    // 💵 Precio en ARS según la lista actual
    const precioEnPesos = this.calcularPrecioPOS(producto);

    const index = this.carrito.findIndex(
      item => item.productoId === producto.id
    );

    if (index >= 0) {

      this.carrito[index].stockDisponible = stockDisponible;
      this.carrito[index].cantidad++;

      this.carrito[index].subtotal =
        this.carrito[index].cantidad *
        this.carrito[index].precioUnitario;

    } else {

      this.carrito.push({
        productoId: producto.id,
        nombre: producto.descripcion,
        cantidad: 1,

        // 🔥 Siempre guardamos el precio en ARS
        precioUnitario: precioEnPesos,

        subtotal: precioEnPesos,
        stockDisponible
      });
    }

    this.calcularTotal();

    if (desdeBusquedaManual) {
      this.busquedaManual = '';
      this.productosFiltrados = [];
      this.modoBusquedaManual = false;
    }
  }

  editarCantidad(index: number, nuevaCantidad: number) {
    const item = this.carrito[index];
    nuevaCantidad = Math.floor(Number(nuevaCantidad) || 0);

    if (nuevaCantidad < 1) {
      nuevaCantidad = 1;
    }

    // 📦 No dejamos superar el stock disponible
    if (nuevaCantidad > item.stockDisponible) {
      this.avisarSinStock(item.nombre, item.stockDisponible, nuevaCantidad);
      nuevaCantidad = Math.max(item.stockDisponible, 1);
    }

    this.carrito[index].cantidad = nuevaCantidad;
    this.carrito[index].subtotal = nuevaCantidad * this.carrito[index].precioUnitario;
    this.calcularTotal();
  }

  editarPrecio(index: number, nuevoPrecio: number) {
    if (nuevoPrecio < 0) return;
    this.carrito[index].precioUnitario = nuevoPrecio;
    this.carrito[index].subtotal = nuevoPrecio * this.carrito[index].cantidad;
    this.calcularTotal();
  }

  eliminarDelCarrito(index: number) {
    this.carrito.splice(index, 1);
    this.calcularTotal();
  }

  calcularTotal() {
    this.total = this.carrito.reduce((sum, item) => sum + item.subtotal, 0);
    this.puntosAplicados = this.getPuntosAplicados(this.carrito);
  }

  async finalizarVenta() {
    console.log('Iniciando proceso de finalización de venta...');
    if (this.carrito.length === 0 || this.recalculandoPrecios || this.procesandoVenta) return;

    if (this.calcularResumen().errorPago) {
      this.mostrarErrorPago = true;
      return;
    }

    this.mostrarErrorPago = false;

    // Caja activa
    const cajaActiva = this.cajaActiva || this.cajaService.getCajaActiva();
    if (!cajaActiva) {
      await Swal.fire('❌ No hay caja abierta', 'Debes abrir caja antes de vender.', 'error');
      return;
    }

    const resumen = this.calcularResumen();
    const cliente = this.clienteActual;

    // ✅ CONFIRMACIÓN con detalle de descuentos
    const filas: string[] = [];
    if (resumen.descuentoCupon > 0) filas.push(`Cupón ${this.cuponAplicado?.codigo || ''}: -${this.formatearMoneda(resumen.descuentoCupon)}`);
    if (resumen.descuentoPuntos > 0) filas.push(`${resumen.puntosUsados} puntos: -${this.formatearMoneda(resumen.descuentoPuntos)}`);
    for (const p of resumen.pagos.filter(x => x.descuento > 0)) {
      filas.push(`${nombreMetodo(p.metodo)} (${p.porcentajeDescuento}%${resumen.pagos.length > 1 ? ' sobre su parte' : ''}): -${this.formatearMoneda(p.descuento)}`);
    }
    if (resumen.puntosASumar > 0) filas.push(`El cliente suma ${resumen.puntosASumar} puntos`);
    const detallePagos = resumen.pagos.length > 1
      ? `<div class="mt-2 small text-start d-inline-block">${resumen.pagos
          .map(p => `${nombreMetodo(p.metodo)}: <strong>${this.formatearMoneda(p.monto)}</strong>`).join('<br>')}</div>`
      : `<div class="small text-muted">${nombreMetodo(resumen.pagos[0]?.metodo)}</div>`;

    const result = await Swal.fire({
      title: 'Confirmar venta',
      html: `
        <div style="font-size: 16px;">
          <div class="text-muted">Lista ${this.tipoPrecio.toUpperCase()} · Subtotal ${this.formatearMoneda(resumen.subtotal)}</div>
          ${filas.map(f => `<div class="small">${f}</div>`).join('')}
          <div class="mt-2">Total a pagar:</div>
          <strong style="font-size: 22px;">${this.formatearMoneda(resumen.totalFinal)}</strong>
          ${detallePagos}
        </div>
      `,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Confirmar',
      cancelButtonText: 'Cancelar'
    });

    if (!result.isConfirmed) return;

    const tipoStock = this.tipoPrecio;
    const sucursalId = cajaActiva.sucursalId || this.selectedSucursal?.id;

    if (tipoStock === 'minorista' && !sucursalId) {
      await Swal.fire('❌ Sucursal no definida', 'No se pudo determinar la sucursal para descontar stock.', 'error');
      return;
    }

    const cupon = resumen.descuentoCupon > 0 ? this.cuponAplicado : null;

    // 🧾 OBJETO VENTA
    const venta = {
      fecha: new Date().toISOString(),
      tipoPrecio: this.tipoPrecio,
      cliente: cliente
        ? { id: cliente.id, dni: cliente.dni, nombre: cliente.nombre, tipo: cliente.tipo }
        : null,
      items: this.carrito.map(item => ({
        productoId: item.productoId,
        nombre: item.nombre,
        cantidad: item.cantidad,
        precioUnitario: item.precioUnitario,
        subtotal: item.subtotal,
        // Registro de qué stock se descontó (sirve para devoluciones/anulaciones)
        stockDescontado: tipoStock === 'mayorista'
          ? { tipo: 'mayorista', cantidad: item.cantidad }
          : { tipo: 'minorista', sucursales: [{ sucursalId, cantidad: item.cantidad }] }
      })),
      subtotal: resumen.subtotal,
      cupon: cupon
        ? { id: cupon.id ?? null, codigo: cupon.codigo ?? null, tipo: cupon.tipo ?? null, valor: cupon.valor ?? null }
        : null,
      descuentoCupon: resumen.descuentoCupon,
      puntosUsados: resumen.puntosUsados,
      descuentoPuntos: resumen.descuentoPuntos,
      porcentajeDescuentoPago: resumen.pagos.length === 1 ? resumen.porcentajePago : null,
      descuentoPago: resumen.descuentoPago,
      total: resumen.totalFinal, // lo que efectivamente pagó el cliente
      puntosGanados: resumen.puntosASumar,
      metodoPago: metodoResumen(resumen.pagos),  // el medio, o 'mixto' si pagó con varios
      pagos: resumen.pagos,                      // detalle: cuánto con cada medio
      sucursalId: cajaActiva.sucursalId,
      cajaId: cajaActiva.id,
      usuario: this.auditoria.getUsuarioActual(), // quién hizo la venta
      nroTicket: null as number | null            // se asigna dentro de la transacción
    };

    if (!venta.usuario) {
      await Swal.fire('Sesión vencida', 'No se pudo identificar al usuario. Volvé a iniciar sesión.', 'error');
      return;
    }

    // Registro de auditoría: se guarda en la MISMA transacción que la venta
    const ventaRef = doc(collection(this.firestore, 'Ventas'));
    const contadorTicketsRef = this.tickets.refContador();
    const registroAuditoria = await this.auditoria.armarRegistro({
      accion: 'venta',
      entidad: 'Ventas',
      entidadId: ventaRef.id,
      descripcion: `Venta local por ${this.formatearMoneda(resumen.totalFinal)} (${this.textoPagosResumen(resumen)}, lista ${this.tipoPrecio})` +
        (cliente ? ` a ${cliente.nombre}` : ''),
      extra: {
        total: resumen.totalFinal,
        pagos: resumen.pagos.map(p => `${p.metodo}: ${p.monto}`),
        items: venta.items.map(i => `${i.cantidad} x ${i.nombre} @ ${i.precioUnitario}`),
        sucursalId: venta.sucursalId,
        cajaId: venta.cajaId
      }
    });
    const descripcionAuditoria: string = registroAuditoria?.descripcion || '';

    const clienteRef = cliente?.id && (resumen.puntosUsados > 0 || resumen.puntosASumar > 0)
      ? doc(this.firestore, 'Clientes', cliente.id)
      : null;
    const cuponRef = cupon?.id ? doc(this.firestore, 'Cupones', cupon.id) : null;
    const cajaRef = doc(this.firestore, 'Cajas', cajaActiva.id);

    // 💾 Una sola transacción: stock + puntos + cupón + venta.
    // Si algo falla (stock, puntos, cupón), no se guarda NADA.
    const productosActualizados: any[] = [];
    this.procesandoVenta = true;

    try {
      await runTransaction(this.firestore, async (tx) => {

        // 1) Lecturas (Firestore exige leer todo antes de escribir)
        const lecturas = await Promise.all(
          venta.items.map(async item => {
            const ref = doc(this.firestore, 'productos', item.productoId);
            return { item, ref, snap: await tx.get(ref) };
          })
        );
        const clienteSnap = clienteRef ? await tx.get(clienteRef) : null;
        const cuponSnap = cuponRef ? await tx.get(cuponRef) : null;
        const cajaSnap = await tx.get(cajaRef);
        const contadorSnap = await tx.get(contadorTicketsRef);

        // 1.b) La caja tiene que seguir abierta (pudo cerrarse desde otra PC)
        const datosCaja: any = cajaSnap.exists() ? cajaSnap.data() : null;
        if (!datosCaja || datosCaja.abierta === false) {
          throw new VentaError('La caja de esta sucursal está cerrada. Abrí una caja nueva para seguir vendiendo.');
        }

        // 2) Validación de stock
        const faltantes: { productoId: string; nombre: string; disponible: number; solicitado: number }[] = [];
        const nuevosDatos: { ref: any; data: any; update: any }[] = [];

        for (const { item, ref, snap } of lecturas) {
          if (!snap.exists()) {
            faltantes.push({ productoId: item.productoId, nombre: item.nombre, disponible: 0, solicitado: item.cantidad });
            continue;
          }

          const data: any = { id: snap.id, ...snap.data() };
          data.stockSucursales = this.normalizarStockSucursales(data.stockSucursales);
          const disponible = this.getStockDisponible(data, tipoStock);

          if (item.cantidad > disponible) {
            faltantes.push({ productoId: item.productoId, nombre: item.nombre, disponible, solicitado: item.cantidad });
            continue;
          }

          if (tipoStock === 'mayorista') {
            data.stockMayorista = disponible - item.cantidad;
            nuevosDatos.push({ ref, data, update: { stockMayorista: data.stockMayorista } });
          } else {
            const entrada = data.stockSucursales.find((s: any) => s.sucursalId === sucursalId);
            entrada.cantidad = disponible - item.cantidad;
            nuevosDatos.push({ ref, data, update: { stockSucursales: data.stockSucursales } });
          }
        }

        if (faltantes.length) {
          throw new StockInsuficienteError(faltantes);
        }

        // 3) Validación de puntos (con el saldo REAL del cliente)
        let puntosNuevos: number | null = null;
        if (clienteRef) {
          if (!clienteSnap?.exists()) {
            throw new VentaError('No se encontró el cliente para registrar los puntos.');
          }
          const puntosActuales = Number(clienteSnap.data()?.['puntos']) || 0;
          if (resumen.puntosUsados > puntosActuales) {
            throw new VentaError(`El cliente solo tiene ${puntosActuales} puntos disponibles. Desactivá el canje y volvé a intentar.`);
          }
          puntosNuevos = puntosActuales - resumen.puntosUsados + resumen.puntosASumar;
        }

        // 4) Validación de cupón (puede haberse agotado)
        let cuponUpdate: any = null;
        if (cuponRef) {
          const datosCupon: any = cuponSnap?.exists() ? cuponSnap.data() : null;
          const disponible = datosCupon ? (datosCupon.cantidadDisponible ?? 1) : 0;
          if (!datosCupon || datosCupon.activo === false || disponible <= 0) {
            throw new VentaError('El cupón ya no está disponible. Quitalo y volvé a intentar.');
          }
          cuponUpdate = { cantidadDisponible: disponible - 1 };
          if (disponible - 1 <= 0) cuponUpdate.activo = false;
        }

        // 5) Escrituras
        for (const { ref, data, update } of nuevosDatos) {
          tx.update(ref, update);
          productosActualizados.push(data);
        }
        if (clienteRef && puntosNuevos !== null) {
          tx.update(clienteRef, { puntos: puntosNuevos });
        }
        if (cuponRef && cuponUpdate) {
          tx.update(cuponRef, cuponUpdate);
        }
        // Número de ticket correlativo (no se repite: se toma dentro de la transacción)
        const ultimo = contadorSnap.exists() ? (Number((contadorSnap.data() as any).valor) || 0) : 0;
        venta.nroTicket = ultimo + 1;
        tx.set(contadorTicketsRef, { valor: venta.nroTicket }, { merge: true });
        if (registroAuditoria) {
          registroAuditoria.descripcion = `Ticket #${this.tickets.numeroFormateado(venta)} - ${descripcionAuditoria}`;
        }

        tx.set(ventaRef, venta);
        this.auditoria.registrarEnTransaccion(tx, registroAuditoria);

        // Contador de ventas de la caja (sirve para controlar el cierre)
        if (typeof datosCaja.cantidadVentas === 'number') {
          tx.update(cajaRef, { cantidadVentas: datosCaja.cantidadVentas + 1 });
        }
      });
    } catch (err: any) {
      if (err instanceof StockInsuficienteError) {
        const detalle = err.faltantes
          .map(f => `<li><strong>${f.nombre}</strong>: pedido ${f.solicitado}, disponible ${f.disponible}</li>`)
          .join('');
        await Swal.fire({
          title: '📦 Stock insuficiente',
          html: `No se registró la venta. Revisá estos productos:<ul style="text-align:left">${detalle}</ul>`,
          icon: 'error'
        });
        // Actualizamos el stock conocido en el carrito para que el vendedor ajuste
        for (const f of err.faltantes) {
          const item = this.carrito.find(i => i.productoId === f.productoId);
          if (item) item.stockDisponible = f.disponible;
        }
      } else if (err instanceof VentaError) {
        await Swal.fire('No se registró la venta', err.message, 'warning');
        if (err.message.startsWith('La caja de esta sucursal está cerrada')) {
          this.cajaService.clearCajaActiva();
          this.cajaActiva = null;
          this.selectedSucursal = null;
        }
      } else {
        console.error('Error registrando venta:', err);
        await Swal.fire('❌ Error', 'No se pudo registrar la venta. ' + (err?.message || ''), 'error');
      }
      return;
    } finally {
      this.procesandoVenta = false;
    }

    // 🔄 Mantener la cache local alineada con el nuevo stock
    for (const p of productosActualizados) {
      await this.productosCache.actualizarProducto(p);
    }

    // ✅ MENSAJE FINAL
    const resultFinal = await Swal.fire({
      title: `✅ Venta realizada · Ticket Nº ${this.tickets.numeroFormateado(venta)}`,
      text: resumen.puntosASumar > 0
        ? `La venta fue registrada. ${cliente?.nombre} sumó ${resumen.puntosASumar} puntos.`
        : 'La venta fue registrada correctamente.',
      icon: 'success',
      showCancelButton: true,
      showDenyButton: true,
      confirmButtonText: '🖨 Imprimir ticket',
      denyButtonText: 'Ver ticket',
      cancelButtonText: 'Cerrar'
    });

    if (resultFinal.isConfirmed) {
      this.tickets.abrir(venta, 'imprimir');
    } else if (resultFinal.isDenied) {
      this.tickets.abrir(venta, 'vista');
    }

    // 🔄 RESET completo para la próxima venta
    this.carrito = [];
    this.total = 0;
    this.clienteActual = null;
    this.busquedaRealizada = false;
    this.tipoPrecio = 'minorista';
    this.precioForzadoManualmente = false;
    this.productoCache = {};
    this.lineasPago = [{ metodo: null, monto: null }];
    this.mostrarErrorPago = false;
    this.usarPuntos = false;
    this.puntosAplicados = 0;
    this.eliminarCupon();
    if (this.dniInput) this.dniInput.nativeElement.value = '';
  }


  /** Ticket de la venta (vista previa con botón Imprimir) */
  abrirComprobante(venta: any) {
    this.tickets.abrir(venta, 'vista');
  }

  // =====================================================
  // 🔧 COBRO DE REPARACIONES
  // =====================================================

  mostrarReparaciones = false;
  repBusqueda: number | null = null;
  repBuscando = false;
  repBuscado = false;
  repResultados: any[] = [];
  repOrden: any = null;           // orden elegida para cobrar
  repMonto: number | null = null;
  repLineas: LineaPago[] = [{ metodo: null, monto: null }];
  repEntregar = true;
  repCobrando = false;

  abrirReparaciones() {
    if (!this.cajaActiva) return;
    this.mostrarReparaciones = true;
    this.repBusqueda = null;
    this.repBuscado = false;
    this.repResultados = [];
    this.repOrden = null;
  }

  cerrarReparaciones() {
    if (this.repCobrando) return;
    this.mostrarReparaciones = false;
  }

  async buscarOrdenes(por: 'numero' | 'dni') {
    const valor = Math.floor(Number(this.repBusqueda));
    if (!valor || valor < 1) return;
    this.repBuscando = true;
    this.repOrden = null;
    try {
      this.repResultados = por === 'numero'
        ? await this.cobroReparaciones.buscarPorNumero(valor)
        : await this.cobroReparaciones.buscarPorDni(valor);
      this.repBuscado = true;
      if (this.repResultados.length === 1) {
        this.elegirOrden(this.repResultados[0]);
      }
    } catch (err: any) {
      console.error('Error buscando órdenes:', err);
      Swal.fire('Error', 'No se pudieron buscar las órdenes. ' + (err?.message || ''), 'error');
    } finally {
      this.repBuscando = false;
    }
  }

  repSaldo(orden: any): number {
    return this.cobroReparaciones.saldo(orden);
  }

  repPagado(orden: any): number {
    return this.cobroReparaciones.totalPagado(orden);
  }

  elegirOrden(orden: any) {
    this.repOrden = orden;
    const saldo = this.repSaldo(orden);
    this.repMonto = saldo > 0 ? saldo : null;
    this.repLineas = [{ metodo: null, monto: null }];
    // Si se cobra todo y la orden sigue pendiente, por defecto se entrega el equipo
    this.repEntregar = orden.coleccion === 'Ordenes Pendientes';
  }

  /** Reparto del monto a cobrar entre los medios (sin descuentos) */
  get repPagos() {
    return calcularPagos(Number(this.repMonto) || 0, this.repLineas, () => 0);
  }

  get repCobroValido(): boolean {
    if (!this.repOrden || this.repPagos.error) return false;
    const monto = Number(this.repMonto);
    return monto > 0 && monto <= this.repSaldo(this.repOrden) + 0.009;
  }

  async confirmarCobroReparacion() {
    if (!this.cajaActiva || !this.repCobroValido || this.repCobrando) return;

    const orden = this.repOrden;
    const monto = Number(this.repMonto);
    const saldo = this.repSaldo(orden);
    const esParcial = monto < saldo - 0.009;
    const entregar = this.repEntregar && orden.coleccion === 'Ordenes Pendientes';
    const pagos = this.repPagos.pagos;
    const textoPagos = pagos.length === 1
      ? nombreMetodo(pagos[0].metodo)
      : pagos.map(p => `${nombreMetodo(p.metodo)} ${this.formatearMoneda(p.monto)}`).join(' + ');

    const r = await Swal.fire({
      title: 'Confirmar cobro',
      html: `Orden <strong>#${orden.numeroOrden}</strong> · ${orden.equipo || ''}<br>
             <span style="font-size:22px">${this.formatearMoneda(monto)}</span><br><small>${textoPagos}</small><br>
             ${esParcial ? `<small>Cobro parcial: queda un saldo de ${this.formatearMoneda(saldo - monto)}</small><br>` : ''}
             ${entregar ? '<br><strong>Se entrega el equipo</strong> (la orden pasa a Finalizadas)' : ''}`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Cobrar',
      cancelButtonText: 'Volver'
    });
    if (!r.isConfirmed) return;

    this.repCobrando = true;
    try {
      const res = await this.cobroReparaciones.cobrar(this.cajaActiva, orden, pagos, entregar);

      this.mostrarReparaciones = false;

      const fin = await Swal.fire({
        title: `✅ Cobro registrado · Ticket Nº ${this.tickets.numeroFormateado(res.venta)}`,
        html: (res.saldoRestante > 0
          ? `Saldo pendiente de la orden: <strong>${this.formatearMoneda(res.saldoRestante)}</strong>`
          : 'La reparación quedó <strong>totalmente paga</strong>.') +
          (res.entregada ? '<br>El equipo quedó como <strong>entregado</strong>.' : ''),
        icon: 'success',
        showCancelButton: true,
        showDenyButton: true,
        confirmButtonText: '🖨 Imprimir ticket',
        denyButtonText: 'Ver ticket',
        cancelButtonText: 'Cerrar'
      });
      if (fin.isConfirmed) this.tickets.abrir(res.venta, 'imprimir');
      else if (fin.isDenied) this.tickets.abrir(res.venta, 'vista');

    } catch (err: any) {
      if (err instanceof CobroReparacionError) {
        await Swal.fire('No se pudo cobrar', err.message, 'warning');
        if (err.message.startsWith('La caja está cerrada')) {
          this.mostrarReparaciones = false;
          this.cajaService.clearCajaActiva();
          this.cajaActiva = null;
          this.selectedSucursal = null;
        }
      } else {
        console.error('Error cobrando reparación:', err);
        await Swal.fire('Error', 'No se pudo registrar el cobro. ' + (err?.message || ''), 'error');
      }
    } finally {
      this.repCobrando = false;
    }
  }

  /** Buscador de tickets en una ventana dentro de despacho (no se pierde la venta en curso) */
  mostrarTickets = false;

  abrirBuscadorTickets() {
    this.mostrarTickets = true;
    // Los calendarios y desplegables de Material tienen que quedar por encima de la ventana
    document.body.classList.add('tickets-abierto');
  }

  cerrarBuscadorTickets() {
    this.mostrarTickets = false;
    document.body.classList.remove('tickets-abierto');
  }


  async filtrarProductos() {
    if (this.busquedaManual.length > 2) {
      this.productosFiltrados = await this.productosCache.buscarProductos(this.busquedaManual);
      // Los que tienen stock primero
      this.productosFiltrados.sort((a, b) =>
        (this.getStockDisponible(b) > 0 ? 1 : 0) - (this.getStockDisponible(a) > 0 ? 1 : 0)
      );
    } else {
      this.productosFiltrados = [];
    }
  }

  // =====================================================
  // 💰 IMPORTES Y DESCUENTOS
  // =====================================================

  /** Precio minorista → hay descuentos. Precio mayorista → ninguno. */
  get aplicanDescuentos(): boolean {
    return this.tipoPrecio === 'minorista';
  }

  /** Puntos: solo clientes minoristas identificados, comprando a precio minorista */
  get puedeUsarPuntos(): boolean {
    return this.aplicanDescuentos && this.clienteActual?.tipo === 'minorista' && !!this.clienteActual.id;
  }

  get resumen(): ResumenVenta {
    return this.calcularResumen();
  }

  calcularResumen(): ResumenVenta {
    const subtotal = this.total || 0;

    if (!this.aplicanDescuentos) {
      // Mayorista: sin descuentos, pero puede dividir el pago igual
      const pago = calcularPagos(subtotal, this.lineasPago, () => 0);
      return {
        subtotal, aplicaDescuentos: false,
        descuentoCupon: 0, puntosUsados: 0, descuentoPuntos: 0,
        totalBase: subtotal, porcentajePago: 0, descuentoPago: 0,
        pagos: pago.pagos, errorPago: pago.error,
        totalFinal: subtotal, puntosASumar: 0
      };
    }

    let total = subtotal;

    // 1) Cupón
    let descuentoCupon = 0;
    const cupon = this.cuponAplicado;
    if (cupon && cupon.activo !== false) {
      descuentoCupon = cupon.tipo === 'porcentaje'
        ? total * (Number(cupon.valor) || 0) / 100
        : Math.min(Number(cupon.valor) || 0, total);
      total = Math.max(total - descuentoCupon, 0);
    }

    // 2) Puntos
    let puntosUsados = 0;
    let descuentoPuntos = 0;
    if (this.usarPuntos && this.puedeUsarPuntos && this.valorMonetarioPorPunto > 0) {
      const disponibles = Number(this.clienteActual?.puntos) || 0;
      puntosUsados = Math.max(0, Math.min(disponibles, Math.floor(total / this.valorMonetarioPorPunto)));
      descuentoPuntos = puntosUsados * this.valorMonetarioPorPunto;
      total = Math.max(total - descuentoPuntos, 0);
    }

    const totalBase = total;

    // 3) Medio(s) de pago: cada parte lleva el descuento de su medio (proporcional)
    const pago = calcularPagos(totalBase, this.lineasPago, m => this.porcentajeDeMetodo(m));
    const descuentoPago = pago.error ? 0 : pago.descuentoTotal;
    const totalFinal = pago.error ? totalBase : pago.totalFinal;
    const porcentajePago = !pago.error && pago.pagos.length === 1 ? pago.pagos[0].porcentajeDescuento : 0;

    // 4) Puntos a sumar: sobre lo que efectivamente paga (solo cliente minorista)
    const puntosASumar = this.puedeUsarPuntos && this.valorParaSumarPunto > 0
      ? Math.floor(totalFinal / this.valorParaSumarPunto)
      : 0;

    return {
      subtotal, aplicaDescuentos: true,
      descuentoCupon, puntosUsados, descuentoPuntos,
      totalBase, porcentajePago, descuentoPago,
      pagos: pago.pagos, errorPago: pago.error,
      totalFinal, puntosASumar
    };
  }

  // =====================================================
  // 💳 MEDIOS DE PAGO (uno o varios)
  // =====================================================

  /** % de descuento de cada medio (solo con lista minorista) */
  porcentajeDeMetodo(m: MetodoPago | null): number {
    if (!this.aplicanDescuentos) return 0;
    return m === 'efectivo' ? (this.descuentoEfectivo || 0)
      : m === 'transferencia' ? (this.descuentoTransferencia || 0) : 0;
  }

  get pagoDividido(): boolean {
    return this.lineasPago.length > 1;
  }

  // Sirven para la venta (lineasPago) y para el cobro de reparaciones (repLineas)

  elegirMetodo(lineas: LineaPago[], i: number, metodo: MetodoPago) {
    // Si el medio ya está en otra línea, se intercambian
    const otra = lineas.findIndex((l, j) => j !== i && l.metodo === metodo);
    if (otra >= 0) lineas[otra].metodo = lineas[i].metodo;
    lineas[i].metodo = metodo;
    this.mostrarErrorPago = false;
  }

  /** Agrega otro medio: el que estaba último pasa a tener monto y el nuevo queda como "resto" */
  agregarMedioPago(lineas: LineaPago[]) {
    if (lineas.length >= this.metodosPago.length) return;
    const usados = lineas.map(l => l.metodo);
    const libre = this.metodosPago.find(m => !usados.includes(m.valor))?.valor || null;
    lineas.push({ metodo: libre, monto: null });
    this.mostrarErrorPago = false;
  }

  quitarMedioPago(lineas: LineaPago[], i: number) {
    if (lineas.length <= 1) return;
    lineas.splice(i, 1);
    // Con un solo medio no hay monto que cargar: paga todo
    if (lineas.length === 1) lineas[0].monto = null;
    this.mostrarErrorPago = false;
  }

  /** Medio(s) de un cobro de reparación ya registrado */
  textoPagosCobro(c: any): string {
    return textoPagos({ ...c, total: c.monto }, n => this.formatearMoneda(n));
  }

  hayMonto(lineas: LineaPago[]): boolean {
    return lineas.some(l => l.monto !== null && l.monto !== undefined && String(l.monto) !== '');
  }

  private textoPagosResumen(r: ResumenVenta): string {
    return r.pagos.length === 1
      ? r.pagos[0].metodo
      : r.pagos.map(p => `${p.metodo} ${this.formatearMoneda(p.monto)}`).join(' + ');
  }

  private formatearMoneda(valor: number): string {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(valor || 0);
  }

async forzarTipoPrecio(tipo: 'minorista' | 'mayorista') {

  // Un cliente identificado queda FIJO en su lista:
  // minorista nunca compra a precio mayorista, mayorista nunca compra a precio minorista.
  if (this.clienteActual && tipo !== this.clienteActual.tipo) {
    await Swal.fire(
      `Cliente ${this.clienteActual.tipo}`,
      `${this.clienteActual.nombre} es cliente ${this.clienteActual.tipo}: solo puede comprar con lista ${this.clienteActual.tipo}.`,
      'warning'
    );
    return;
  }

  this.precioForzadoManualmente = true;
  await this.cambiarListaDePrecios(tipo);

}

}
