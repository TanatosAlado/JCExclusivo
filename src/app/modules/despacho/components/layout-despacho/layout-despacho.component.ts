import { Component, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { Firestore, collection, query, where, getDocs, getDoc, doc, runTransaction, serverTimestamp } from '@angular/fire/firestore';
import Swal from 'sweetalert2';
import { ProductosCacheService } from '../../services/productos-cache.service';
import { CajaService, ResumenCaja, CierreCajaError } from '../../services/caja.service';
import { InformeCierreService } from '../../services/informe-cierre.service';
import { TicketsService } from '../../services/tickets.service';
import { CobroReparacionesService, CobroReparacionError, METODOS_CON_DESCUENTO_REPARACION, MAX_ORDENES_POR_COBRO } from '../../services/cobro-reparaciones.service';
import { desgloseDeOrden, imputarCobroReparacion, repartirCobroOrdenes, sumarDesgloses } from '../../services/desglose-reparacion';
import {
  METODOS_PAGO, METODO_CUENTA_CORRIENTE, MetodoPago, LineaPago, PagoVenta, calcularPagos, metodoResumen, nombreMetodo, textoPagos,
  conDetalleTarjeta, MAX_DETALLE_PAGO, ResultadoPagos
} from '../../services/pagos';
import {
  CalculoCredito, DatosCanje, MAX_DETALLE_CANJE, calcularCredito, PLANES_INICIALES, PlanCuotas, conInteres, datosFaltantes, mesCuota, textoVencimiento, validarCanje,
  SituacionCredito, situacionCredito, estadoCuota, faltaCuota, imputarCuotas, estaBloqueado, ultimaCarta, fechaCorta,
  RECARGO_DIARIO, recargoPorAtraso, recargoRefinanciacion, calcularRefinanciacion, CalculoRefinanciacion
} from '../../services/credito-casa';
import { Credito, CreditoError, CreditosService, PagoCredito } from '../../services/creditos.service';
import { CuentaCorrienteService, CuentaCorrienteError, CuentaCorriente, MovimientoCuenta } from '../../services/cuenta-corriente.service';
import { imputarFIFO, diasDesde } from '../../services/cuenta-corriente';
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
import { colorValido, nombreColor } from 'src/app/shared/utils/colores';
import { CajerosService, Cajero, cajeroParaVenta, nombreCajero } from 'src/app/modules/admin/services/cajeros.service';
import {
  EquiposService, Equipo, nombreEquipo, condicionDe, nombreCondicion,
  CAPACIDADES, GRADOS, DatosEquipoCanje, validarEquipoCanje, fichaEquipoCanje, normalizarImei, imeiValido
} from 'src/app/modules/admin/services/equipos.service';
import { cotizacionEquipos } from 'src/app/shared/utils/equipos-tienda';
import { TasadorService } from 'src/app/modules/admin/services/tasador.service';
import { ModeloTasador, ResultadoTasacion, textoUSD } from 'src/app/shared/utils/tasador';

interface ClientePOS {
  id: string;
  dni: string;
  nombre: string;
  tipo: 'minorista' | 'mayorista';
  puntos: number;
  /** Deuda en cuenta corriente (solo mayoristas; null mientras se consulta) */
  saldoCuenta?: number | null;
  /** Contacto (obligatorio para el crédito de la casa) */
  telefono?: string;
  direccion?: string;
}

interface ProductoPOS {
  id: string;
  codigoBarras: string;
  descripcion: string;
  precioMinorista: number;
  precioMayorista: number;
}

interface ItemCarritoPOS {
  productoId: string | null; // null = producto cargado a mano (no está en el sistema)
  manual?: boolean;          // cargado a mano: NO descuenta stock
  nombre: string;
  cantidad: number;
  precioUnitario: number; // editable
  subtotal: number;
  stockDisponible: number; // stock al momento de agregarlo (según lista de precios y sucursal)
  color?: string | null;   // variante por color (hex), para el circulito
  modelo?: string | null;  // variante por modelo
  /** Equipo (unidad única por IMEI): cantidad fija 1, sin descuentos automáticos */
  equipoId?: string | null;
  equipo?: DatosEquipoCarrito | null;
  /** Equipo en dólares: precio en US$ (editable). precioUnitario = precioUsd × dólar de equipos */
  precioUsd?: number | null;
}

/** Datos del equipo que viajan en el carrito y quedan en la venta */
interface DatosEquipoCarrito {
  condicion?: 'nuevo' | 'usado';
  modelo: string;
  color: string;
  capacidad: string;
  imei: string;
  bateria: number;
  grado: string;
  observaciones: string;
  moneda: 'USD' | 'ARS';
  precioMinorista: number;    // en su moneda
  precioMayorista: number;
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
  subtotalEquipos: number;    // equipos (sin descuentos automáticos)
  porcentajeEquipos: number;  // % manual del cajero para los equipos
  descuentoEquipos: number;
  totalBase: number;          // después de cupón, puntos y descuento de equipos
  porcentajePago: number;     // % por efectivo/transferencia (si paga con un solo medio)
  descuentoPago: number;      // suma de los descuentos por medio de pago
  pagos: PagoVenta[];         // cuánto paga con cada medio (uno o varios)
  errorPago: string | null;   // pagos incompletos o inválidos
  totalFinal: number;         // lo que efectivamente paga
  puntosASumar: number;
  canje: DatosCanje | null;           // 📲 plan canje (equipo usado como parte de pago)
  credito: CalculoCredito | null;     // 🏠 crédito de la casa (precio financiado, entrega y cuotas)
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

  // Cajero que cobra (obligatorio, se elige en cada venta / cobro: arranca siempre vacío)
  cajeros: Cajero[] = [];
  cajeroId: string | null = null;
  mostrarErrorCajero = false;
  repCajeroId: string | null = null;
  readonly nombreCajero = nombreCajero;
  private cajerosSub?: Subscription;

  // Circulito de color de las variantes
  readonly colorValido = colorValido;
  readonly nombreColor = nombreColor;

  // ===== 📲 Plan canje y 🏠 crédito de la casa (solo ventas con equipo) =====
  usaCanje = false;
  canjeMonto: number | null = null;
  canjeDetalle = '';                      // solo si NO se da de alta el equipo (roto, para repuestos…)
  canjeAlta = true;                       // dar de alta el equipo usado (queda "En preparación")
  canjeEquipo: DatosEquipoCanje = this.canjeEquipoVacio();
  // 🧮 Tasador (Plan canje)
  mostrarTasador = false;
  modelosTasador: ModeloTasador[] = [];
  cargandoTasador = false;
  canjeTasacion: ResultadoTasacion | null = null;   // la última tasación usada (se muestra al lado del importe)
  readonly textoUSD = textoUSD;
  readonly capacidadesCanje = CAPACIDADES;
  readonly gradosCanje = GRADOS;
  ventaCredito = false;
  creditoPrecio: number | null = null;    // precio de contado YA CON EL CANJE DESCONTADO, ajustado al cobrar (vacío = lista − canje)
  creditoEntrega: number | null = null;
  creditoCuotas: number | null = null;
  creditoTelefono = '';                   // se completan con los del cliente y se pueden corregir
  creditoDireccion = '';
  planesCredito: PlanCuotas[] = PLANES_INICIALES.map(p => ({ ...p }));   // se leen de Gestiones → Créditos
  readonly maxDetalleCanje = MAX_DETALLE_CANJE;
  readonly textoVencimiento = textoVencimiento;
  readonly nombreMetodo = nombreMetodo;
  readonly mesCuota = mesCuota;

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

  /** Con cuánto paga el cliente la parte en efectivo (para calcular el vuelto). Opcional. */
  pagaCon: number | null = null;
  mostrarErrorPagaCon = false;

  /** Pago con tarjeta: nº de operación del posnet u otra observación (opcional, texto libre) */
  detalleTarjeta = '';
  readonly maxDetallePago = MAX_DETALLE_PAGO;

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

  descuentoEfectivo: number = 0;        // configurado en Gestiones → Empresa
  descuentoTransferencia: number = 0;   // configurado en Gestiones → Empresa
  /**
   * % modificado a mano en esta venta.
   * null = usa el configurado (y lo muestra); '' = el cajero borró el campo (mientras escribe, usa el configurado).
   */
  descuentoManual: { efectivo: number | string | null; transferencia: number | string | null } = { efectivo: null, transferencia: null };
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
    private buscadorClientes: BuscadorClientesService,
    private cajerosService: CajerosService,
    private cuentasCorrientes: CuentaCorrienteService,
    private equiposService: EquiposService,
    private creditos: CreditosService,
    private tasador: TasadorService
  ) { }


async ngOnInit() {
  this.cargarPlanesCredito();
  // Cajeros activos en tiempo real (si se da de alta uno, aparece sin recargar)
  this.cajerosSub = this.cajerosService.listar().subscribe({
    next: lista => {
      this.cajeros = lista.filter(c => c.activo !== false);
      if (this.cajeroId && !this.cajeros.some(c => c.id === this.cajeroId)) this.cajeroId = null;
      if (this.repCajeroId && !this.cajeros.some(c => c.id === this.repCajeroId)) this.repCajeroId = null;
      if (this.ccCajeroId && !this.cajeros.some(c => c.id === this.ccCajeroId)) this.ccCajeroId = null;
      if (this.cuCajeroId && !this.cajeros.some(c => c.id === this.cuCajeroId)) this.cuCajeroId = null;
    },
    error: e => console.error('Error cargando cajeros', e)
  });

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
        this.dolarJC = cotizacionEquipos(info);   // equipos: dólar JC (o el común si no está)
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
    this.cajerosSub?.unsubscribe();
    
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
      puntos: data.puntos || 0,
      saldoCuenta: catCliente === 'mayorista' ? null : 0,
      telefono: String(data.telefono ?? '').trim(),
      direccion: String(data.direccion ?? '').trim()
    };
    this.creditoTelefono = this.clienteActual.telefono || '';
    this.creditoDireccion = this.clienteActual.direccion || '';
    if (catCliente === 'mayorista') this.cargarSaldoCuenta(this.clienteActual);
    await this.cambiarListaDePrecios(this.clienteActual.tipo);
  }

  /** Deuda actual del cliente mayorista (se muestra al lado del nombre) */
  private async cargarSaldoCuenta(cliente: ClientePOS) {
    try {
      const cuenta = await this.cuentasCorrientes.obtenerCuenta(cliente.id);
      cliente.saldoCuenta = cuenta?.saldo || 0;
    } catch (e) {
      console.error('Error leyendo la cuenta corriente:', e);
      cliente.saldoCuenta = undefined;
    }
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
    this.quitarCuentaCorrienteSiNoCorresponde();
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
        if (item.equipoId && item.equipo) {                // equipo: precio de su lista
          if (item.equipo.moneda === 'USD') {
            item.precioUsd = this.precioListaUsd(item.equipo, nuevoTipo);
            item.precioUnitario = this.usdAPesos(item.precioUsd);
          } else {
            item.precioUnitario = this.precioEquipo(item.equipo, nuevoTipo);
          }
          item.subtotal = item.precioUnitario;
          continue;
        }
        if (item.manual || !item.productoId) continue; // cargado a mano: conserva su precio
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
        stockDisponible,
        color: colorValido((producto as any).color),
        modelo: (producto as any).modelo || null
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
    if (item.equipoId) {          // un equipo es una unidad única
      item.cantidad = 1;
      item.subtotal = item.precioUnitario;
      this.calcularTotal();
      return;
    }
    nuevaCantidad = Math.floor(Number(nuevaCantidad) || 0);

    if (nuevaCantidad < 1) {
      nuevaCantidad = 1;
    }

    // 📦 No dejamos superar el stock disponible (salvo productos cargados a mano: no tienen stock)
    if (!item.manual && nuevaCantidad > item.stockDisponible) {
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

    const faltaPago = !!this.calcularResumen().errorPago;
    const cajero = this.cajeroSeleccionado(this.cajeroId);
    // Si cargó con cuánto paga, tiene que alcanzar para la parte en efectivo
    const pagaConInsuficiente = !faltaPago && this.faltaEfectivo > 0;
    this.mostrarErrorPago = faltaPago;
    this.mostrarErrorCajero = !cajero;
    this.mostrarErrorPagaCon = pagaConInsuficiente;
    if (faltaPago || !cajero || pagaConInsuficiente) return;

    // Caja activa
    const cajaActiva = this.cajaActiva || this.cajaService.getCajaActiva();
    if (!cajaActiva) {
      await Swal.fire('❌ No hay caja abierta', 'Debes abrir caja antes de vender.', 'error');
      return;
    }

    const resumenCalculado = this.calcularResumen();
    // El pago con tarjeta lleva el nº de operación del posnet (si lo cargaron)
    const resumen: ResumenVenta = { ...resumenCalculado, pagos: conDetalleTarjeta(resumenCalculado.pagos, this.detalleTarjeta) };
    const cliente = this.clienteActual;

    // 📒 Parte a cuenta corriente (solo cliente mayorista identificado)
    const aCuenta = Math.round(resumen.pagos.filter(p => p.metodo === 'cuentacorriente').reduce((a, p) => a + p.monto, 0) * 100) / 100;
    if (aCuenta > 0 && !this.puedeUsarCuentaCorriente) {
      await Swal.fire('Cuenta corriente', 'La cuenta corriente es solo para clientes mayoristas identificados.', 'warning');
      return;
    }
    const saldoPrevio = Number(cliente?.saldoCuenta) || 0;

    // ✅ CONFIRMACIÓN con detalle de descuentos
    const filas: string[] = [];
    if (resumen.descuentoCupon > 0) filas.push(`Cupón ${this.cuponAplicado?.codigo || ''}: -${this.formatearMoneda(resumen.descuentoCupon)}`);
    if (resumen.descuentoPuntos > 0) filas.push(`${resumen.puntosUsados} puntos: -${this.formatearMoneda(resumen.descuentoPuntos)}`);
    if (resumen.descuentoEquipos > 0) filas.push(`Descuento equipos (${resumen.porcentajeEquipos}%): -${this.formatearMoneda(resumen.descuentoEquipos)}`);
    for (const p of resumen.pagos.filter(x => x.descuento > 0)) {
      filas.push(`${nombreMetodo(p.metodo)} (${p.porcentajeDescuento}%${resumen.pagos.length > 1 ? ' sobre su parte' : ''}${resumen.subtotalEquipos > 0 ? ', solo productos' : ''}): -${this.formatearMoneda(p.descuento)}`);
    }
    if (resumen.puntosASumar > 0) filas.push(`El cliente suma ${resumen.puntosASumar} puntos`);
    // El canje va aparte (arriba del total): acá solo cómo paga
    const pagosDinero = resumen.pagos.filter(p => p.metodo !== 'canje');
    const detallePagos = pagosDinero.length > 1
      ? `<div class="mt-2 small text-start d-inline-block">${pagosDinero
          .map(p => `${nombreMetodo(p.metodo)}: <strong>${this.formatearMoneda(p.monto)}</strong>${this.textoOperacion(p)}`).join('<br>')}</div>`
      : `<div class="small text-muted">${nombreMetodo(pagosDinero[0]?.metodo)}${this.textoOperacion(pagosDinero[0])}</div>`;

    const result = await Swal.fire({
      title: 'Confirmar venta',
      html: `
        <div style="font-size: 16px;">
          <div class="text-muted">Lista ${this.tipoPrecio.toUpperCase()} · Subtotal ${this.formatearMoneda(resumen.subtotal)}</div>
          ${filas.map(f => `<div class="small">${f}</div>`).join('')}
          ${resumen.canje ? `<div class="small">📲 Plan canje: -${this.formatearMoneda(resumen.canje.monto)}</div>` : ''}
          <div class="mt-2">Total a pagar${resumen.credito ? ' (entrega + cuotas)' : ''}:</div>
          <strong style="font-size: 22px;">${this.formatearMoneda(this.totalAPagar)}</strong>
          ${detallePagos}
          ${this.vuelto !== null ? `<div class="mt-2" style="font-size:15px">Paga con ${this.formatearMoneda(this.pagaCon as number)} · ` +
            `<strong>Vuelto: ${this.formatearMoneda(this.vuelto)}</strong></div>` : ''}
          ${aCuenta > 0 ? `<div class="mt-2 p-2" style="background:#fff8e1;border-radius:6px;font-size:15px">
            📒 Queda a cuenta corriente: <strong>${this.formatearMoneda(aCuenta)}</strong><br>
            <small>Deuda de ${this.escaparHtml(cliente?.nombre)}: ${this.formatearMoneda(saldoPrevio)} → <strong>${this.formatearMoneda(saldoPrevio + aCuenta)}</strong></small>
          </div>` : ''}
          ${resumen.canje ? `<div class="mt-2 small">📲 Plan canje: <strong>${this.formatearMoneda(resumen.canje.monto)}</strong> · ${this.escaparHtml(resumen.canje.detalle)}</div>` : ''}
          ${resumen.credito ? this.htmlConfirmacionCredito(resumen.credito) : ''}
          <div class="mt-2 small">Cobra: <strong>${this.escaparHtml(nombreCajero(cajero))}</strong></div>
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
        manual: item.manual === true,  // cargado a mano: no descuenta stock
        nombre: item.nombre,
        color: item.color || null,     // variante (hex)
        modelo: item.modelo || null,
        cantidad: item.cantidad,
        precioUnitario: item.precioUnitario,
        subtotal: item.subtotal,
        // 📱 Equipo: unidad única (se marca vendido en la misma transacción)
        ...(item.equipoId && item.equipo ? {
          tipo: 'equipo',
          equipoId: item.equipoId,
          equipo: {
            ...item.equipo,
            precioLista: tipoStock === 'mayorista' ? item.equipo.precioMayorista : item.equipo.precioMinorista,
            precioVentaUsd: item.equipo.moneda === 'USD' ? (item.precioUsd ?? null) : null,   // el que quedó (pudo editarse)
            cotizacionDolar: item.equipo.moneda === 'USD' ? this.cotizacionEquipos : null
          }
        } : {}),
        // Registro de qué stock se descontó (sirve para devoluciones/anulaciones)
        stockDescontado: item.manual || item.equipoId
          ? null
          : tipoStock === 'mayorista'
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
      subtotalEquipos: resumen.subtotalEquipos,
      porcentajeDescuentoEquipos: resumen.porcentajeEquipos || null,
      descuentoEquipos: resumen.descuentoEquipos,
      // Con equipos en el carrito, el descuento por efectivo / transferencia es solo sobre los productos
      descuentosSoloProductos: resumen.subtotalEquipos > 0,
      porcentajeDescuentoPago: resumen.pagos.length === 1 ? resumen.porcentajePago : null,
      descuentoPago: resumen.descuentoPago,
      total: resumen.totalFinal, // lo que efectivamente pagó el cliente
      puntosGanados: resumen.puntosASumar,
      metodoPago: metodoResumen(resumen.pagos),  // el medio, o 'mixto' si pagó con varios
      pagos: resumen.pagos,                      // detalle: cuánto con cada medio
      efectivoRecibido: this.vuelto !== null ? this.pagaCon : null, // con cuánto pagó la parte en efectivo
      vuelto: this.vuelto,                       // solo informativo: a la caja entra el importe de la venta
      sucursalId: cajaActiva.sucursalId,
      cajaId: cajaActiva.id,
      usuario: this.auditoria.getUsuarioActual(), // sesión con la que se hizo la venta
      cajero: cajeroParaVenta(cajero),            // quién la cobró
      nroTicket: null as number | null,           // se asigna dentro de la transacción
      // Parte a cuenta corriente: importe y saldo del cliente antes/después (se completa en la transacción)
      cuentaCorriente: null as { importe: number; saldoAnterior: number; saldoPosterior: number } | null,
      // 📲 Equipo usado recibido como parte de pago
      canje: resumen.canje,
      // 🏠 Crédito de la casa (el detalle y el seguimiento están en Creditos/{id de la venta})
      credito: resumen.credito ? {
        creditoId: '',
        precioLista: resumen.credito.precioLista,
        precioContado: resumen.credito.precioContado,
        precioFinanciado: resumen.credito.precioFinanciado,
        recargo: resumen.credito.recargo,
        interes: resumen.credito.interes,
        aFinanciar: resumen.credito.aFinanciar,
        canje: resumen.credito.canje,
        entrega: resumen.credito.entrega,
        saldo: resumen.credito.saldo,
        cantidadCuotas: resumen.credito.cuotas.length,
        cuotas: resumen.credito.cuotas
      } : null
    };

    if (!venta.usuario) {
      await Swal.fire('Sesión vencida', 'No se pudo identificar al usuario. Volvé a iniciar sesión.', 'error');
      return;
    }

    // Registro de auditoría: se guarda en la MISMA transacción que la venta
    const ventaRef = doc(collection(this.firestore, 'Ventas'));
    if (venta.credito) venta.credito.creditoId = ventaRef.id;
    // 🏠 Crédito: datos de contacto (se guardan en el cliente si los corrigieron)
    const contactoCredito = venta.credito && cliente ? {
      telefono: String(this.creditoTelefono || '').trim().slice(0, 40),
      direccion: String(this.creditoDireccion || '').trim().slice(0, 200)
    } : null;
    const creditoRef = venta.credito ? doc(this.firestore, 'Creditos', ventaRef.id) : null;
    // 📲 Plan canje con alta: el equipo usado entra a Equipos "En preparación" en la misma operación
    const datosEquipoCanje = resumen.canje && this.canjeAlta ? { ...this.canjeEquipo } : null;
    const equipoCanjeRef = datosEquipoCanje ? doc(collection(this.firestore, 'Equipos')) : null;
    const imeiCanjeRef = datosEquipoCanje ? this.equiposService.refIndiceImei(datosEquipoCanje.imei) : null;
    if (venta.canje && equipoCanjeRef) venta.canje = { ...venta.canje, equipoId: equipoCanjeRef.id };
    const clienteCreditoRef = venta.credito && cliente ? doc(this.firestore, 'Clientes', cliente.id) : null;
    const contadorTicketsRef = this.tickets.refContador();
    const registroAuditoria = await this.auditoria.armarRegistro({
      accion: 'venta',
      entidad: 'Ventas',
      entidadId: ventaRef.id,
      descripcion: `Venta local por ${this.formatearMoneda(resumen.totalFinal)} (${this.textoPagosResumen(resumen)}, lista ${this.tipoPrecio})` +
        (cliente ? ` a ${cliente.nombre}` : '') + ` · cobró ${nombreCajero(cajero)}`,
      extra: {
        total: resumen.totalFinal,
        pagos: resumen.pagos.map(p => `${p.metodo}: ${p.monto}${p.detalle ? ` (${p.detalle})` : ''}`),
        // Descuentos por medio de pago modificados a mano (configurado → usado)
        descuentosModificados: this.mediosConDescuento.filter(m => this.descuentoModificado(m))
          .map(m => `${m}: ${this.porcentajeConfigurado(m)}% → ${this.porcentajeDeMetodo(m)}%`),
        cajero: nombreCajero(cajero),
        items: venta.items.map((i: any) => `${i.cantidad} x ${i.nombre} @ ${i.precioUnitario}${i.manual ? ' (cargado a mano, sin stock)' : ''}${i.equipoId ? ` (equipo IMEI ${i.equipo?.imei})` : ''}`),
        descuentoEquipos: resumen.descuentoEquipos ? `${resumen.porcentajeEquipos}%: ${resumen.descuentoEquipos}` : null,
        canje: resumen.canje ? `${resumen.canje.monto} (${resumen.canje.detalle})` : null,
        credito: resumen.credito
          ? `contado ${resumen.credito.precioContado} → financiado ${resumen.credito.precioFinanciado} (interés ${resumen.credito.interes}%); entrega ${resumen.credito.entrega}; ` +
            `${resumen.credito.cuotas.length} cuota(s) de ${resumen.credito.cuotas[0]?.importe}`
          : null,
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
    const cuentaRef = aCuenta > 0 && cliente ? this.cuentasCorrientes.refCuenta(cliente.id) : null;
    const clienteCuentaRef = aCuenta > 0 && cliente ? doc(this.firestore, 'Clientes', cliente.id) : null;

    // 💾 Una sola transacción: stock + puntos + cupón + venta.
    // Si algo falla (stock, puntos, cupón), no se guarda NADA.
    const productosActualizados: any[] = [];
    this.procesandoVenta = true;

    try {
      await runTransaction(this.firestore, async (tx) => {

        // 1) Lecturas (Firestore exige leer todo antes de escribir)
        // Los productos cargados a mano no están en el sistema: no se lee ni descuenta stock
        const lecturas = await Promise.all(
          venta.items.filter(item => !item.manual && !!item.productoId).map(async item => {
            const ref = doc(this.firestore, 'productos', item.productoId as string);
            return { item, ref, snap: await tx.get(ref) };
          })
        );
        const clienteSnap = clienteRef ? await tx.get(clienteRef) : null;
        const cuponSnap = cuponRef ? await tx.get(cuponRef) : null;
        const cajaSnap = await tx.get(cajaRef);
        const contadorSnap = await tx.get(contadorTicketsRef);
        const cuentaSnap = cuentaRef ? await tx.get(cuentaRef) : null;
        const clienteCuentaSnap = clienteCuentaRef ? await tx.get(clienteCuentaRef) : null;
        const clienteCreditoSnap = clienteCreditoRef ? await tx.get(clienteCreditoRef) : null;
        // 📱 Equipos: tienen que seguir disponibles (pudo venderse desde otra PC o la web)
        const lecturasEquipos: { item: any; ref: any; imeiRef: any; data: any; imeiData: any }[] = [];
        for (const item of venta.items.filter((i: any) => !!i.equipoId)) {
          const ref = this.equiposService.refEquipo(item.equipoId);
          const snap = await tx.get(ref);
          const data: any = snap.exists() ? snap.data() : null;
          const imeiRef = data?.imei ? this.equiposService.refIndiceImei(data.imei) : null;
          const imeiSnap = imeiRef ? await tx.get(imeiRef) : null;
          lecturasEquipos.push({ item, ref, imeiRef, data, imeiData: imeiSnap?.exists() ? imeiSnap.data() : null });
        }
        // 📲 El IMEI del equipo del canje no puede estar cargado en otro equipo
        const imeiCanjeSnap = imeiCanjeRef ? await tx.get(imeiCanjeRef) : null;
        if (imeiCanjeSnap?.exists()) {
          const otro: any = imeiCanjeSnap.data();
          throw new VentaError(`El IMEI del equipo del plan canje ya está cargado en otro equipo${otro?.modelo ? ` (${otro.modelo})` : ''}. ` +
            'Revisalo o destildá "Dar de alta el equipo".');
        }
        const equiposNoDisponibles = lecturasEquipos.filter(l => !l.data || l.data.estado !== 'disponible');
        if (equiposNoDisponibles.length) {
          throw new VentaError(`Ya no está disponible: ${equiposNoDisponibles.map(l => l.item.nombre).join(', ')}. ` +
            'Sacalo del carrito (pudo haberse vendido desde otra caja o la tienda).');
        }

        // 1.a) Cuenta corriente: el cliente tiene que seguir siendo mayorista
        if (clienteCuentaRef) {
          const datosCliente: any = clienteCuentaSnap?.exists() ? clienteCuentaSnap.data() : null;
          if (!datosCliente || datosCliente.esMayorista !== true) {
            throw new VentaError('El cliente ya no es mayorista: no puede comprar a cuenta corriente.');
          }
        }

        // 1.a') Crédito de la casa: el cliente tiene que existir
        if (clienteCreditoRef && !clienteCreditoSnap?.exists()) {
          throw new VentaError('No se encontró el cliente: no se puede dar el crédito.');
        }

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

        // 📱 Equipos vendidos: dejan de estar a la venta (el IMEI queda libre)
        for (const l of lecturasEquipos) {
          tx.update(l.ref, {
            estado: 'vendido',
            venta: {
              ventaId: ventaRef.id,
              nroTicket: venta.nroTicket,
              fecha: venta.fecha,
              origen: 'local',
              cliente: venta.cliente,
              tipoPrecio: venta.tipoPrecio,
              precio: l.item.subtotal,                  // en pesos, antes del descuento de equipos
              sucursalId: venta.sucursalId || null,
              cajaId: venta.cajaId,
              cajero: venta.cajero,
              usuario: venta.usuario
            }
          });
          if (l.imeiRef && l.imeiData?.equipoId === l.item.equipoId) tx.delete(l.imeiRef);
        }

        // Compra a cuenta corriente: suma a la deuda del cliente
        if (cuentaRef && cuentaSnap && cliente) {
          const saldos = this.cuentasCorrientes.escribirCargo(tx, cuentaSnap, {
            cliente: { id: cliente.id, nombre: cliente.nombre, dni: cliente.dni },
            ventaId: ventaRef.id,
            nroTicket: venta.nroTicket,
            fecha: venta.fecha,
            importe: aCuenta,
            detalle: venta.items.map(i => `${i.cantidad} x ${i.nombre}`).join(', ').slice(0, 300),
            sucursalId: venta.sucursalId || null,
            cajaId: venta.cajaId,
            usuario: venta.usuario,
            cajero: venta.cajero
          });
          venta.cuentaCorriente = { importe: aCuenta, ...saldos };
          if (registroAuditoria) registroAuditoria.descripcion += ` · ${this.formatearMoneda(aCuenta)} a cuenta corriente`;
        }

        // 🏠 Crédito de la casa: el crédito con sus cuotas + datos de contacto del cliente
        if (creditoRef && venta.credito && cliente) {
          const datosCliente: any = clienteCreditoSnap?.data() || {};
          if (contactoCredito && clienteCreditoRef &&
            (contactoCredito.telefono !== String(datosCliente.telefono ?? '').trim()
              || contactoCredito.direccion !== String(datosCliente.direccion ?? '').trim())) {
            tx.update(clienteCreditoRef, contactoCredito);
          }
          tx.set(creditoRef, {
            ventaId: ventaRef.id,
            nroTicket: venta.nroTicket,
            fecha: venta.fecha,
            sucursalId: venta.sucursalId || null,
            cajaId: venta.cajaId,
            cliente: {
              id: cliente.id,
              nombre: cliente.nombre,
              dni: cliente.dni ?? null,
              telefono: contactoCredito?.telefono || '',
              direccion: contactoCredito?.direccion || ''
            },
            detalle: venta.items.map(i => `${i.cantidad} x ${i.nombre}`).join(', ').slice(0, 300),
            equipos: venta.items.filter((i: any) => i.tipo === 'equipo')
              .map((i: any) => ({ nombre: i.nombre, imei: i.equipo?.imei || '' })),
            precioLista: venta.credito.precioLista,
            precioContado: venta.credito.precioContado,
            precioFinanciado: venta.credito.precioFinanciado,
            recargo: venta.credito.recargo,         // interés en pesos
            interes: venta.credito.interes,         // % del plan
            aFinanciar: venta.credito.aFinanciar,   // sin interés
            canje: venta.canje || null,
            entrega: venta.credito.entrega,
            importe: venta.credito.saldo,     // lo financiado (no cambia)
            saldo: venta.credito.saldo,       // lo que falta pagar
            pagado: 0,
            cantidadCuotas: venta.credito.cantidadCuotas,
            cuotas: venta.credito.cuotas,
            estado: 'vigente',
            usuario: venta.usuario,
            cajero: venta.cajero,
            creadoEn: serverTimestamp()
          });
          if (registroAuditoria) {
            registroAuditoria.descripcion += ` · 🏠 crédito de la casa: ${this.formatearMoneda(venta.credito.saldo)} en ` +
              `${venta.credito.cantidadCuotas} cuota(s)`;
          }
        }

        // 📲 Alta del equipo del plan canje (usado, en preparación: sin precios ni fotos)
        if (equipoCanjeRef && imeiCanjeRef && datosEquipoCanje && venta.canje) {
          const ficha = fichaEquipoCanje(datosEquipoCanje, {
            ventaId: ventaRef.id,
            nroTicket: venta.nroTicket ?? null,
            monto: venta.canje.monto,
            fecha: venta.fecha,
            cliente: { id: cliente?.id || null, nombre: cliente?.nombre || 'Consumidor final' },
            sucursalId: venta.sucursalId || null
          }, venta.usuario);
          tx.set(equipoCanjeRef, ficha);
          tx.set(imeiCanjeRef, { equipoId: equipoCanjeRef.id, modelo: ficha.modelo });
          if (registroAuditoria) {
            registroAuditoria.descripcion += ` · 📲 plan canje: entró ${nombreEquipo(ficha)} (IMEI ${ficha.imei}) en preparación`;
          }
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
      } else if (err instanceof VentaError || err instanceof CuentaCorrienteError) {
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
      html: (venta.vuelto !== null && venta.vuelto !== undefined
          ? `<div style="font-size:22px;margin-bottom:8px">Vuelto: <strong>${this.formatearMoneda(venta.vuelto)}</strong></div>`
          : '') +
        (venta.canje?.equipoId
          ? `<div style="margin-bottom:8px">📲 El equipo del plan canje quedó cargado <strong>En preparación</strong><br>
             <small>Cuando tengas tiempo, cargale fotos y precios en Gestiones → Equipos y publicalo.</small></div>`
          : '') +
        (venta.credito
          ? `<div style="margin-bottom:8px">🏠 Crédito de la casa: <strong>${venta.credito.cantidadCuotas} cuota(s) de ` +
            `${this.formatearMoneda(venta.credito.cuotas[0]?.importe)}</strong><br>
             <small>La primera vence del ${this.escaparHtml(textoVencimiento(venta.credito.cuotas[0]))}. El plan de pagos sale en el ticket.</small></div>`
          : '') +
        (venta.cuentaCorriente
          ? `<div style="margin-bottom:8px">📒 Quedó a cuenta corriente: <strong>${this.formatearMoneda(venta.cuentaCorriente.importe)}</strong><br>
             Deuda de ${this.escaparHtml(cliente?.nombre)}: <strong>${this.formatearMoneda(venta.cuentaCorriente.saldoPosterior)}</strong></div>`
          : '') +
        (resumen.puntosASumar > 0
          ? `La venta fue registrada. ${cliente?.nombre} sumó ${resumen.puntosASumar} puntos.`
          : 'La venta fue registrada correctamente.'),
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
    this.cajeroId = null;            // la próxima venta vuelve a pedir el cajero
    this.pagaCon = null;
    this.detalleTarjeta = '';
    this.descuentoManual = { efectivo: null, transferencia: null };
    this.descuentoEquipos = null;
    this.dolarEquipos = null;          // la próxima venta arranca con el dólar de la empresa
    this.equiposDisponibles = [];      // se vuelven a leer (los vendidos ya no aparecen)
    this.mostrarErrorPagaCon = false;
    this.mostrarErrorCajero = false;
    this.usarPuntos = false;
    this.puntosAplicados = 0;
    this.reiniciarCreditoYCanje();
    this.eliminarCupon();
    if (this.dniInput) this.dniInput.nativeElement.value = '';
  }

  /** Detalle del crédito para la confirmación (ya escapado) */
  private htmlConfirmacionCredito(c: CalculoCredito): string {
    const $ = (n: number) => this.formatearMoneda(n);
    const filas = [
      c.canje ? `Precio del equipo: ${$(c.precioContado)}` : '',
      c.canje ? `Plan canje: −${$(c.canje)}` : '',
      `Precio de contado: ${$(c.precioContado - c.canje)}${c.precioContado !== c.precioLista ? ` <small>(ajustado; lista ${$(c.precioLista)})</small>` : ''}`,
      c.entrega ? `Entrega hoy: −${$(c.entrega)}` : '',
      `A financiar: ${$(c.aFinanciar)}`,
      `Interés del plan (${c.cuotas.length} cuota${c.cuotas.length > 1 ? 's' : ''}, ${c.interes}%): +${$(c.recargo)}`
    ].filter(Boolean).map(f => `<div>${f}</div>`).join('');
    const cuotas = c.cuotas.map(q => `<div>Cuota ${q.numero}: <strong>${$(q.importe)}</strong> · vence del ${this.escaparHtml(textoVencimiento(q))}</div>`).join('');
    return `<div class="mt-2 p-2 text-start" style="background:#eef6ff;border-radius:6px;font-size:14px">
      <div><strong>🏠 Crédito de la casa</strong></div>${filas}
      <div class="mt-1">Financia: <strong>${$(c.saldo)}</strong> en ${c.cuotas.length} cuota(s)</div>
      <div class="mt-1 small">${cuotas}</div>
    </div>`;
  }


  // =====================================================
  // ✍️ PRODUCTO CARGADO A MANO (no está en el sistema, no descuenta stock)
  // =====================================================

  async agregarProductoManual() {
    const r = await Swal.fire({
      title: 'Agregar producto a mano',
      html: `
        <div style="text-align:left">
          <label for="pmNombre" style="font-size:13px;color:#555">Descripción</label>
          <input id="pmNombre" class="swal2-input" style="margin:4px 0 12px;width:100%;box-sizing:border-box" placeholder="Ej: Funda nueva modelo X" maxlength="120">
          <div style="display:flex;gap:10px">
            <div style="flex:2">
              <label for="pmPrecio" style="font-size:13px;color:#555">Precio unitario ($)</label>
              <input id="pmPrecio" type="number" min="0" step="0.01" class="swal2-input" style="margin:4px 0;width:100%;box-sizing:border-box" placeholder="0">
            </div>
            <div style="flex:1">
              <label for="pmCantidad" style="font-size:13px;color:#555">Cantidad</label>
              <input id="pmCantidad" type="number" min="1" step="1" value="1" class="swal2-input" style="margin:4px 0;width:100%;box-sizing:border-box">
            </div>
          </div>
          <p style="font-size:12px;color:#888;margin:10px 0 0">No descuenta stock. Usalo para productos nuevos que todavía no están cargados.</p>
        </div>`,
      focusConfirm: false,
      showCancelButton: true,
      confirmButtonText: 'Agregar al carrito',
      cancelButtonText: 'Cancelar',
      didOpen: () => (document.getElementById('pmNombre') as HTMLInputElement)?.focus(),
      preConfirm: () => {
        const nombre = ((document.getElementById('pmNombre') as HTMLInputElement)?.value || '').trim();
        const precio = Number((document.getElementById('pmPrecio') as HTMLInputElement)?.value);
        const cantidad = Math.floor(Number((document.getElementById('pmCantidad') as HTMLInputElement)?.value));
        if (nombre.length < 2) { Swal.showValidationMessage('Escribí la descripción del producto'); return false; }
        if (!(precio > 0)) { Swal.showValidationMessage('Ingresá un precio mayor a 0'); return false; }
        if (!(cantidad >= 1)) { Swal.showValidationMessage('La cantidad tiene que ser 1 o más'); return false; }
        return { nombre, precio: Math.round(precio * 100) / 100, cantidad };
      }
    });
    if (!r.isConfirmed || !r.value) return;

    const { nombre, precio, cantidad } = r.value as { nombre: string; precio: number; cantidad: number };
    this.carrito.push({
      productoId: null,
      manual: true,
      nombre,
      cantidad,
      precioUnitario: precio,
      subtotal: precio * cantidad,
      stockDisponible: 0,
      color: null,
      modelo: null
    });
    this.calcularTotal();
  }

  // =====================================================
  // 💵 VUELTO (parte en efectivo)
  // =====================================================

  /** Importe a cobrar en efectivo (con descuento), 0 si no paga en efectivo */
  get montoEfectivo(): number {
    const r = this.resumen;
    if (r.errorPago) return 0;
    return Math.round(r.pagos.filter(p => p.metodo === 'efectivo').reduce((a, p) => a + p.monto, 0) * 100) / 100;
  }

  /** Vuelto a dar (null si no cargó con cuánto paga o no alcanza) */
  get vuelto(): number | null {
    return this.calcularVuelto(this.montoEfectivo, this.pagaCon);
  }

  /** Lo que falta si entregó menos de lo que hay que cobrar en efectivo */
  get faltaEfectivo(): number {
    return this.calcularFalta(this.montoEfectivo, this.pagaCon);
  }

  /** Billetes / montos redondos sugeridos para "Paga con" */
  get sugerenciasPagaCon(): number[] {
    return this.sugerirBilletes(this.montoEfectivo);
  }

  // ---- Cálculos comunes (venta y cobro de reparaciones) ----

  private calcularVuelto(monto: number, pagaCon: number | null): number | null {
    const recibido = Number(pagaCon);
    if (!monto || !(recibido > 0) || recibido < monto - 0.004) return null;
    return Math.round((recibido - monto) * 100) / 100;
  }

  private calcularFalta(monto: number, pagaCon: number | null): number {
    const recibido = Number(pagaCon);
    if (!monto || !(recibido > 0)) return 0;
    return Math.max(0, Math.round((monto - recibido) * 100) / 100);
  }

  private sugerirBilletes(monto: number): number[] {
    if (!monto) return [];
    const redondeos = [1000, 2000, 5000, 10000, 20000];
    const opciones = redondeos.map(r => Math.ceil(monto / r) * r).filter(v => v > monto + 0.004);
    return [...new Set(opciones)].sort((a, b) => a - b).slice(0, 4);
  }

  // ---- Vuelto en el cobro de reparaciones ----

  /** Parte del cobro de la reparación que se paga en efectivo */
  get repMontoEfectivo(): number {
    const r = this.repPagos;
    if (r.error) return 0;
    return Math.round(r.pagos.filter(p => p.metodo === 'efectivo').reduce((a, p) => a + p.monto, 0) * 100) / 100;
  }

  get repVuelto(): number | null {
    return this.calcularVuelto(this.repMontoEfectivo, this.repPagaCon);
  }

  get repFaltaEfectivo(): number {
    return this.calcularFalta(this.repMontoEfectivo, this.repPagaCon);
  }

  get repSugerenciasPagaCon(): number[] {
    return this.sugerirBilletes(this.repMontoEfectivo);
  }

  elegirPagaCon(valor: number) {
    this.pagaCon = valor;
    this.mostrarErrorPagaCon = false;
  }

  /** Presupuesto con lo que hay en el carrito (no registra nada ni toca stock) */
  imprimirPresupuesto() {
    if (!this.carrito.length || this.recalculandoPrecios) return;
    this.tickets.abrirPresupuesto({
      tipoPrecio: this.tipoPrecio,
      cliente: this.clienteActual?.nombre || null,
      items: this.carrito.map(i => ({
        nombre: i.nombre,
        cantidad: i.cantidad,
        precioUnitario: i.precioUnitario,
        subtotal: i.subtotal,
        color: i.color || null,
        modelo: i.modelo || null,
        // Equipo: datos para el presupuesto y sin descuento por efectivo / transferencia
        ...(i.equipo ? {
          sinDescuento: true,
          detalle: [nombreCondicion(i.equipo), i.equipo.color, i.equipo.grado ? `Grado ${i.equipo.grado}` : '', `Batería ${i.equipo.bateria}%`, i.equipo.observaciones]
            .filter(Boolean).join(' · ')
        } : {})
      })),
      // Si eligió tarjeta, el presupuesto no muestra los precios con descuento por efectivo / transferencia.
      // Si no, muestra los % que se están usando (los configurados o los que se modificaron a mano).
      descuentos: this.lineasPago.some(l => l.metodo === 'tarjeta') ? [] : [
        { medio: 'efectivo', porcentaje: this.porcentajeDeMetodoLista('efectivo') },
        { medio: 'transferencia', porcentaje: this.porcentajeDeMetodoLista('transferencia') }
      ],
      // 🏠 Crédito: solo si eligieron un plan (si no, el cliente no preguntó por cuotas)
      credito: this.ventaCredito && this.resumen.credito ? {
        precioEquipo: this.resumen.credito.precioContado,
        canje: this.resumen.credito.canje,
        canjeDetalle: this.resumen.canje?.detalle || '',
        entrega: this.resumen.credito.entrega,
        cuotas: this.resumen.credito.cuotas
      } : null
    });
  }

  // =====================================================
  // 📱 EQUIPOS (unidades únicas por IMEI)
  // =====================================================

  mostrarEquipos = false;
  cargandoEquipos = false;
  equiposDisponibles: Equipo[] = [];
  filtroEquipos = '';
  /** % de descuento manual para los equipos del carrito (opcional, lo pone el cajero) */
  descuentoEquipos: number | string | null = null;
  /** Dólar JC de Gestiones → Empresa (para los equipos) */
  dolarJC = 0;

  /** Dólar con el que arrancan los equipos: el JC (o el común si no está cargado) */
  get dolarBaseEquipos(): number {
    return Number(this.dolarJC) > 0 ? Number(this.dolarJC) : (Number(this.dolar) || 0);
  }

  /**
   * Dólar para los equipos en esta venta: arranca con el dólar JC de Gestiones → Empresa y el cajero lo puede
   * cambiar (generalmente unos puntos más). null = usa el de la empresa; '' = borró el campo mientras escribe.
   */
  dolarEquipos: number | string | null = null;

  /** Cotización que se usa para los equipos en USD */
  get cotizacionEquipos(): number {
    const v = this.dolarEquipos;
    const n = Number(v);
    if (v !== null && v !== undefined && String(v) !== '' && n > 0) return Math.round(n * 100) / 100;
    return this.dolarBaseEquipos;
  }

  get dolarEquiposModificado(): boolean {
    const v = this.dolarEquipos;
    return v !== null && v !== undefined && String(v) !== '' && Number(v) > 0 && Number(v) !== this.dolarBaseEquipos;
  }

  get dolarEquiposInvalido(): boolean {
    const v = this.dolarEquipos;
    return v !== null && v !== undefined && String(v) !== '' && !(Number(v) > 0);
  }

  get hayEquiposEnDolares(): boolean {
    return this.carrito.some(i => i.equipo?.moneda === 'USD');
  }

  /** Cambió el dólar de equipos: se recalculan los equipos en USD del carrito */
  cambiarDolarEquipos(valor: any) {
    this.dolarEquipos = valor === null ? '' : valor;
    this.mostrarErrorPago = false;
    this.recalcularEquiposEnDolares();
  }

  restablecerDolarEquipos() {
    this.dolarEquipos = null;
    this.recalcularEquiposEnDolares();
  }

  private recalcularEquiposEnDolares() {
    for (const item of this.carrito) {
      if (item.equipo?.moneda !== 'USD') continue;
      // Se respeta el precio en US$ (pudo haberse modificado): cambia solo la conversión a pesos
      if (!(Number(item.precioUsd) >= 0) || item.precioUsd === null || item.precioUsd === undefined) {
        item.precioUsd = this.precioListaUsd(item.equipo);
      }
      item.precioUnitario = this.usdAPesos(item.precioUsd);
      item.subtotal = item.precioUnitario;
    }
    this.calcularTotal();
  }
  readonly nombreEquipo = nombreEquipo;
  readonly condicionEquipo = condicionDe;
  readonly nombreCondicionEquipo = nombreCondicion;

  /** Precio de lista en US$ del equipo según la lista (minorista / mayorista) */
  precioListaUsd(e: { precioMinorista: number; precioMayorista: number }, tipo: 'minorista' | 'mayorista' = this.tipoPrecio): number {
    return Number(tipo === 'mayorista' ? e.precioMayorista : e.precioMinorista) || 0;
  }

  /** US$ → pesos con el dólar de equipos (dólar JC o el que se puso en esta venta) */
  usdAPesos(usd: number | null | undefined): number {
    return Math.round((Number(usd) || 0) * this.cotizacionEquipos * 100) / 100;
  }

  /** Cambió el precio en dólares de un equipo del carrito: se recalcula el subtotal en pesos */
  editarPrecioUsd(index: number, valor: any) {
    const item = this.carrito[index];
    if (!item?.equipo) return;
    const usd = Number(valor);
    if (valor === null || valor === '' || isNaN(usd) || usd < 0) {
      // Vacío o inválido: vuelve al precio de lista
      item.precioUsd = this.precioListaUsd(item.equipo);
    } else {
      item.precioUsd = Math.round(usd * 100) / 100;
    }
    item.precioUnitario = this.usdAPesos(item.precioUsd);
    item.subtotal = item.precioUnitario;
    this.calcularTotal();
  }

  /** ¿El precio en US$ es distinto al de lista? */
  precioUsdModificado(item: ItemCarritoPOS): boolean {
    return !!item.equipo && Number(item.precioUsd) !== this.precioListaUsd(item.equipo);
  }

  async abrirEquipos() {
    this.mostrarEquipos = true;
    this.filtroEquipos = '';
    await this.cargarEquipos();
  }

  cerrarEquipos() {
    this.mostrarEquipos = false;
  }

  async cargarEquipos() {
    this.cargandoEquipos = true;
    try {
      this.equiposDisponibles = (await this.equiposService.listarDisponibles())
        .sort((a, b) => a.modelo.localeCompare(b.modelo, 'es', { numeric: true }));
    } catch (err: any) {
      console.error('Error cargando equipos:', err);
      Swal.fire('Error', 'No se pudieron cargar los equipos. ' + (err?.message || ''), 'error');
    } finally {
      this.cargandoEquipos = false;
    }
  }

  /** Equipos que coinciden con lo escrito (modelo, color, capacidad, IMEI). Los que ya están en el carrito no. */
  get equiposFiltrados(): Equipo[] {
    const enCarrito = new Set(this.carrito.filter(i => i.equipoId).map(i => i.equipoId));
    const palabras = BuscadorClientesService.normalizar(this.filtroEquipos).split(' ').filter(Boolean);
    return this.equiposDisponibles
      .filter(e => !enCarrito.has(e.id))
      .filter(e => {
        if (!palabras.length) return true;
        const texto = BuscadorClientesService.normalizar(`${e.modelo} ${e.color} ${e.capacidad} ${e.imei} ${e.grado}`);
        return palabras.every(p => texto.includes(p));
      });
  }

  /** Enter en el buscador: si hay un IMEI exacto (o un solo resultado), se agrega directo */
  agregarEquipoBuscado() {
    const imei = String(this.filtroEquipos || '').toUpperCase().replace(/[\s\-.\/]/g, '');
    const exacto = this.equiposFiltrados.find(e => e.imei === imei);
    const lista = this.equiposFiltrados;
    if (exacto) this.agregarEquipo(exacto);
    else if (lista.length === 1) this.agregarEquipo(lista[0]);
  }

  /** Precio del equipo en pesos según la lista */
  precioEquipo(e: { moneda: string; precioMinorista: number; precioMayorista: number }, tipo: 'minorista' | 'mayorista' = this.tipoPrecio): number {
    const precio = Number(tipo === 'mayorista' ? e.precioMayorista : e.precioMinorista) || 0;
    const enPesos = e.moneda === 'USD' ? precio * this.cotizacionEquipos : precio;
    return Math.round(enPesos * 100) / 100;
  }

  /** Precio en su moneda para mostrar ("US$ 510") */
  precioEquipoTexto(e: { moneda: string; precioMinorista: number; precioMayorista: number }, tipo: 'minorista' | 'mayorista' = this.tipoPrecio): string {
    const precio = Number(tipo === 'mayorista' ? e.precioMayorista : e.precioMinorista) || 0;
    return e.moneda === 'USD' ? 'US$ ' + precio.toLocaleString('es-AR') : this.formatearMoneda(precio);
  }

  agregarEquipo(e: Equipo) {
    if (this.recalculandoPrecios) return;
    if (this.carrito.some(i => i.equipoId === e.id)) return;
    if (e.moneda === 'USD' && !(this.cotizacionEquipos > 1)) {
      Swal.fire('Falta el dólar', 'No está cargado el valor del dólar en Gestiones → Empresa: no se puede calcular el precio.', 'warning');
      return;
    }
    const precioUsd = e.moneda === 'USD' ? this.precioListaUsd(e) : null;
    const precio = precioUsd !== null ? this.usdAPesos(precioUsd) : this.precioEquipo(e);
    this.carrito.push({
      productoId: null,
      nombre: `${e.modelo} ${e.capacidad}`.trim(),
      cantidad: 1,
      precioUnitario: precio,
      subtotal: precio,
      precioUsd,
      stockDisponible: 1,
      color: null,
      modelo: null,
      equipoId: e.id,
      equipo: {
        condicion: condicionDe(e),
        modelo: e.modelo, color: e.color, capacidad: e.capacidad, imei: e.imei, bateria: e.bateria,
        grado: e.grado, observaciones: e.observaciones || '', moneda: e.moneda,
        precioMinorista: e.precioMinorista, precioMayorista: e.precioMayorista
      }
    });
    this.calcularTotal();
    this.mostrarEquipos = false;
    Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: `Agregado: ${e.modelo}`, showConfirmButton: false, timer: 1800 });
  }

  get hayEquiposEnCarrito(): boolean {
    return this.carrito.some(i => !!i.equipoId);
  }

  /** % manual para equipos que se aplica (0 si está vacío o es inválido) */
  get porcentajeEquiposAplicado(): number {
    const v = this.descuentoEquipos;
    if (v === null || v === undefined || String(v) === '') return 0;
    const n = Number(v);
    return !isNaN(n) && n > 0 && n < 100 ? Math.round(n * 100) / 100 : 0;
  }

  get descuentoEquiposInvalido(): boolean {
    const v = this.descuentoEquipos;
    if (v === null || v === undefined || String(v) === '') return false;
    const n = Number(v);
    return isNaN(n) || n < 0 || n >= 100;
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
  /** Con cuánto paga la parte en efectivo del cobro (para el vuelto). Opcional. */
  repPagaCon: number | null = null;
  /** % de descuento manual sobre la parte en efectivo / transferencia (opcional) */
  repPorcentaje: number | null = null;
  /** Nº de operación del posnet si paga con tarjeta (opcional) */
  repDetalleTarjeta = '';
  repEntregar = true;              // (una sola orden) se entrega el equipo
  // 🔧 Varias órdenes del mismo cliente (mismo DNI / CUIT) en un solo ticket
  repOtras: any[] = [];            // otras órdenes del cliente con saldo
  repBuscandoOtras = false;
  repExtras = new Set<string>();   // ids de las otras órdenes que se suman al cobro
  repEntregarIds = new Set<string>(); // ids de las órdenes cuyo equipo se entrega (si son varias)
  readonly maxOrdenesPorCobro = MAX_ORDENES_POR_COBRO;
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

  /** Nombre del gremio de la orden (se guarda como gremioNombre; nombreGremio por si alguna quedó así) */
  nombreGremio(orden: any): string {
    return String(orden?.gremioNombre || orden?.nombreGremio || '').trim();
  }

  repPagado(orden: any): number {
    return this.cobroReparaciones.totalPagado(orden);
  }

  elegirOrden(orden: any) {
    this.repOrden = orden;
    const saldo = this.repSaldo(orden);
    this.repMonto = saldo > 0 ? saldo : null;
    this.repLineas = [{ metodo: null, monto: null }];
    this.repPagaCon = null;
    this.repPorcentaje = null;
    this.repDetalleTarjeta = '';
    this.repCajeroId = null;
    // Si se cobra todo y la orden sigue pendiente, por defecto se entrega el equipo
    this.repEntregar = orden.coleccion === 'Ordenes Pendientes';
    this.repOtras = [];
    this.repExtras = new Set();
    this.repEntregarIds = new Set(orden.coleccion === 'Ordenes Pendientes' ? [orden.id] : []);
    if (saldo > 0) this.cargarOtrasOrdenes(orden);
  }

  /** Otras órdenes del mismo cliente (mismo DNI / CUIT) que tienen saldo, para cobrarlas juntas */
  private async cargarOtrasOrdenes(orden: any) {
    const documento = String(orden?.dniCliente ?? '').trim();
    const numero = Math.floor(Number(documento));
    if (!documento || !(numero > 0)) return;
    // Si se buscó por DNI ya están todas; si no, se buscan
    const mismas = (l: any[]) => l.filter(o => String(o.dniCliente ?? '').trim() === documento);
    let lista = mismas(this.repResultados);
    const yaEstan = lista.length > 1 || this.repResultados.length > 1;
    this.repBuscandoOtras = !yaEstan;
    try {
      if (!yaEstan) lista = mismas(await this.cobroReparaciones.buscarPorDni(numero));
    } catch (e) {
      console.error('Error buscando otras órdenes del cliente', e);
    } finally {
      this.repBuscandoOtras = false;
    }
    if (this.repOrden?.id !== orden.id) return;      // eligió otra mientras buscaba
    this.repOtras = lista
      .filter(o => o.id !== orden.id && this.repSaldo(o) > 0)
      .sort((a, b) => (Number(a.numeroOrden) || 0) - (Number(b.numeroOrden) || 0));
  }

  repIncluida(o: any): boolean {
    return this.repExtras.has(o.id);
  }

  /** Suma / saca una orden del cobro (el monto vuelve a ser el total) */
  alternarOrden(o: any) {
    if (this.repCobrando) return;
    const extras = new Set(this.repExtras);
    if (extras.has(o.id)) {
      extras.delete(o.id);
      this.repEntregarIds.delete(o.id);
    } else {
      if (extras.size + 1 >= MAX_ORDENES_POR_COBRO) return;
      extras.add(o.id);
      if (o.coleccion === 'Ordenes Pendientes') this.repEntregarIds.add(o.id);
    }
    this.repExtras = extras;
    this.repMonto = this.repSaldoTotal > 0 ? this.repSaldoTotal : null;
  }

  /** Órdenes que entran en el cobro, de la más vieja a la más nueva (la última es la que puede quedar con saldo) */
  get repOrdenesCobro(): any[] {
    if (!this.repOrden) return [];
    return [this.repOrden, ...this.repOtras.filter(o => this.repExtras.has(o.id))]
      .sort((a, b) => (Number(a.numeroOrden) || 0) - (Number(b.numeroOrden) || 0));
  }

  get repVarias(): boolean {
    return this.repOrdenesCobro.length > 1;
  }

  get repSaldoTotal(): number {
    return Math.round(this.repOrdenesCobro.reduce((a, o) => a + this.repSaldo(o), 0) * 100) / 100;
  }

  /** Con varias órdenes: la última (la que se lleva el pago parcial) */
  get repUltimaOrden(): any {
    const l = this.repOrdenesCobro;
    return l[l.length - 1] || null;
  }

  /** Error del reparto entre órdenes (pago parcial que no alcanza para cancelar las anteriores) */
  get repErrorReparto(): string | null {
    if (!this.repVarias) return null;
    const monto = Number(this.repMonto) || 0;
    if (!(monto > 0) || monto > this.repSaldoTotal + 0.009) return null;
    return repartirCobroOrdenes(this.repOrdenesCobro.map(o => this.repSaldo(o)), monto, 0).error;
  }

  repEntrega(o: any): boolean {
    return this.repVarias ? this.repEntregarIds.has(o.id) : this.repEntregar;
  }

  alternarEntrega(o: any) {
    const ids = new Set(this.repEntregarIds);
    if (ids.has(o.id)) ids.delete(o.id); else ids.add(o.id);
    this.repEntregarIds = ids;
  }

  /** ¿Paga (una parte) en efectivo o transferencia? → se puede cargar un % de descuento */
  get repAdmiteDescuento(): boolean {
    return this.repLineas.some(l => !!l.metodo && METODOS_CON_DESCUENTO_REPARACION.includes(l.metodo));
  }

  /** % de descuento que se aplica (0 si no corresponde o es inválido) */
  get repPorcentajeAplicado(): number {
    const p = Number(this.repPorcentaje);
    return this.repAdmiteDescuento && p > 0 && p < 100 ? Math.round(p * 100) / 100 : 0;
  }

  get repPorcentajeInvalido(): boolean {
    const p = this.repPorcentaje;
    return this.repAdmiteDescuento && p !== null && p !== undefined && String(p) !== '' && (Number(p) < 0 || Number(p) >= 100);
  }

  /** Texto de los medios con descuento ("efectivo", "transferencia" o "efectivo y transferencia") */
  get repMediosConDescuento(): string {
    const usados = METODOS_CON_DESCUENTO_REPARACION.filter(m => this.repLineas.some(l => l.metodo === m));
    return usados.join(' y ');
  }

  /**
   * Reparto entre los medios. repMonto = saldo de la orden que se cancela.
   * Efectivo y transferencia pueden tener un % de descuento: paga menos y cancela lo mismo.
   */
  get repPagos() {
    const pct = this.repPorcentajeAplicado;
    return calcularPagos(Number(this.repMonto) || 0, this.repLineas,
      m => METODOS_CON_DESCUENTO_REPARACION.includes(m) ? pct : 0);
  }

  /** Mano de obra / repuestos del presupuesto (null: orden sin discriminar) */
  repDesgloseOrden(orden: any) {
    return desgloseDeOrden(orden);
  }

  /** Cómo se reparte este cobro entre mano de obra y repuestos (el descuento sale de los repuestos) */
  get repDesgloseCobro() {
    if (!this.repOrden || this.repPagos.error) return null;
    const monto = Number(this.repMonto) || 0;
    if (!(monto > 0)) return null;
    if (!this.repVarias) return imputarCobroReparacion(this.repOrden, monto, this.repPagos.descuentoTotal || 0);
    const ordenes = this.repOrdenesCobro;
    const r = repartirCobroOrdenes(ordenes.map(o => this.repSaldo(o)), monto, this.repPagos.descuentoTotal || 0);
    if (!r.partes) return null;
    return sumarDesgloses(r.partes.map((p, i) => ({ desglose: imputarCobroReparacion(ordenes[i], p.importe, p.descuento), cobrado: p.cobrado })));
  }

  /** Lo que efectivamente paga el cliente (con el descuento) */
  get repTotalAPagar(): number {
    const r = this.repPagos;
    return r.error ? (Number(this.repMonto) || 0) : r.totalFinal;
  }

  get repCobroValido(): boolean {
    if (!this.repOrden || this.repPagos.error || !this.cajeroSeleccionado(this.repCajeroId)) return false;
    if (this.repPorcentajeInvalido) return false;
    if (this.repFaltaEfectivo > 0) return false; // lo que entrega no alcanza
    const monto = Number(this.repMonto);
    if (this.repErrorReparto) return false;
    return monto > 0 && monto <= this.repSaldoTotal + 0.009;
  }

  async confirmarCobroReparacion() {
    if (!this.cajaActiva || !this.repCobroValido || this.repCobrando) return;

    const orden = this.repOrden;
    const ordenes = this.repOrdenesCobro;
    const varias = ordenes.length > 1;
    const monto = Number(this.repMonto);
    const saldo = this.repSaldoTotal;
    const esParcial = monto < saldo - 0.009;
    const entregarIds = varias
      ? ordenes.filter(o => this.repEntregarIds.has(o.id) && o.coleccion === 'Ordenes Pendientes').map(o => o.id)
      : (this.repEntregar && orden.coleccion === 'Ordenes Pendientes' ? [orden.id] : []);
    const entregar = entregarIds.length > 0;
    const ultima = ordenes[ordenes.length - 1];
    const textoEntrega = !entregar ? ''
      : varias
        ? `<br><strong>Se entregan los equipos de ${ordenes.filter(o => entregarIds.includes(o.id)).map(o => '#' + o.numeroOrden).join(', ')}</strong> (pasan a Finalizadas)`
        : '<br><strong>Se entrega el equipo</strong> (la orden pasa a Finalizadas)';
    const textoOrdenes = varias
      ? `<strong>${ordenes.length} órdenes</strong> de ${this.escaparHtml([orden.nombreCliente, orden.apellidoCliente].filter(Boolean).join(' '))}<br>
         <small>${ordenes.map(o => `#${o.numeroOrden} · ${this.escaparHtml(o.equipo || '')} · ${this.formatearMoneda(this.repSaldo(o))}`).join('<br>')}</small><br>`
      : `Orden <strong>#${orden.numeroOrden}</strong> · ${orden.equipo || ''}<br>`;
    const pagos = conDetalleTarjeta(this.repPagos.pagos, this.repDetalleTarjeta);
    const cajero = this.cajeroSeleccionado(this.repCajeroId) as Cajero;
    const textoPagos = pagos.length === 1
      ? nombreMetodo(pagos[0].metodo) + this.textoOperacion(pagos[0])
      : pagos.map(p => `${nombreMetodo(p.metodo)} ${this.formatearMoneda(p.monto)}${this.textoOperacion(p)}`).join(' + ');

    const descuentoRep = this.repPagos.descuentoTotal;
    const r = await Swal.fire({
      title: 'Confirmar cobro',
      html: `${textoOrdenes}
             ${descuentoRep > 0 ? `<small>Cancela ${this.formatearMoneda(monto)} del saldo · descuento ${this.repPorcentajeAplicado}%: -${this.formatearMoneda(descuentoRep)}</small><br>` : ''}
             <span style="font-size:22px">${this.formatearMoneda(this.repPagos.totalFinal)}</span><br><small>${textoPagos}</small><br>
             <small>Cobra: <strong>${this.escaparHtml(nombreCajero(cajero))}</strong></small><br>
             ${this.repVuelto !== null ? `<div style="font-size:15px;margin-top:4px">Paga con ${this.formatearMoneda(this.repPagaCon as number)} · <strong>Vuelto: ${this.formatearMoneda(this.repVuelto)}</strong></div>` : ''}
             ${esParcial ? `<small>Cobro parcial: queda un saldo de ${this.formatearMoneda(saldo - monto)}${varias ? ` en la orden #${ultima.numeroOrden}` : ''}</small><br>` : ''}
             ${textoEntrega}`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Cobrar',
      cancelButtonText: 'Volver'
    });
    if (!r.isConfirmed) return;

    this.repCobrando = true;
    try {
      const res = await this.cobroReparaciones.cobrarOrdenes(this.cajaActiva, ordenes, pagos, entregarIds, cajeroParaVenta(cajero),
        { efectivoRecibido: this.repVuelto !== null ? this.repPagaCon : null, vuelto: this.repVuelto });

      this.mostrarReparaciones = false;

      const fin = await Swal.fire({
        title: `✅ Cobro registrado · Ticket Nº ${this.tickets.numeroFormateado(res.venta)}`,
        html: (res.venta.vuelto !== null && res.venta.vuelto !== undefined
            ? `<div style="font-size:22px;margin-bottom:8px">Vuelto: <strong>${this.formatearMoneda(res.venta.vuelto)}</strong></div>`
            : '') +
          (res.saldoRestante > 0
          ? `Saldo pendiente ${varias ? `de la orden #${ultima.numeroOrden}` : 'de la orden'}: <strong>${this.formatearMoneda(res.saldoRestante)}</strong>`
          : varias ? `Las ${ordenes.length} reparaciones quedaron <strong>totalmente pagas</strong>.` : 'La reparación quedó <strong>totalmente paga</strong>.') +
          (res.entregadas.length
            ? (varias ? `<br>Quedaron como <strong>entregados</strong> los equipos de ${res.entregadas.map(n => '#' + n).join(', ')}.` : '<br>El equipo quedó como <strong>entregado</strong>.')
            : ''),
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

  // =====================================================
  // 📒 COBRO DE CUENTA CORRIENTE (total o parcial)
  // =====================================================

  mostrarCobroCuenta = false;
  ccCargandoCuentas = false;
  ccCuentas: CuentaCorriente[] = [];        // clientes con deuda
  ccFiltro = '';
  ccCuenta: CuentaCorriente | null = null;  // cuenta elegida
  ccPendientes: MovimientoCuenta[] = [];    // compras con saldo, de la más vieja a la más nueva
  ccCargandoDetalle = false;
  ccMonto: number | null = null;
  ccLineas: LineaPago[] = [{ metodo: null, monto: null }];
  ccPagaCon: number | null = null;
  /** % de descuento manual sobre la parte que paga en efectivo (opcional) */
  ccPorcentajeEfectivo: number | null = null;
  /** Nº de operación del posnet si paga con tarjeta (opcional) */
  ccDetalleTarjeta = '';
  ccCajeroId: string | null = null;
  ccCobrando = false;
  readonly diasDesde = diasDesde;

  async abrirCobroCuenta() {
    if (!this.cajaActiva) return;
    this.mostrarCobroCuenta = true;
    this.ccFiltro = '';
    this.ccCuenta = null;
    this.ccPendientes = [];
    await this.cargarCuentasConDeuda();
    // Si en la venta hay un cliente mayorista identificado con deuda, se elige directo
    const actual = this.clienteActual?.tipo === 'mayorista' ? this.ccCuentas.find(c => c.id === this.clienteActual!.id) : null;
    if (actual) await this.elegirCuenta(actual);
  }

  cerrarCobroCuenta() {
    if (this.ccCobrando) return;
    this.mostrarCobroCuenta = false;
  }

  private async cargarCuentasConDeuda() {
    this.ccCargandoCuentas = true;
    try {
      this.ccCuentas = (await this.cuentasCorrientes.listarCuentas())
        .filter(c => c.saldo > 0.004)
        .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    } catch (err: any) {
      console.error('Error cargando cuentas corrientes:', err);
      Swal.fire('Error', 'No se pudieron cargar las cuentas corrientes. ' + (err?.message || ''), 'error');
    } finally {
      this.ccCargandoCuentas = false;
    }
  }

  /** Clientes con deuda que coinciden con lo escrito (nombre o DNI) */
  get ccCuentasFiltradas(): CuentaCorriente[] {
    const palabras = BuscadorClientesService.normalizar(this.ccFiltro).split(' ').filter(Boolean);
    if (!palabras.length) return this.ccCuentas;
    return this.ccCuentas.filter(c => {
      const texto = BuscadorClientesService.normalizar(`${c.nombre} ${c.dni ?? ''}`);
      return palabras.every(p => texto.includes(p));
    });
  }

  get ccTotalDeuda(): number {
    return Math.round(this.ccCuentas.reduce((a, c) => a + c.saldo, 0) * 100) / 100;
  }

  /** @param conservar true = vuelve a leer la cuenta sin borrar lo que ya cargó (monto, medios, cajero) */
  async elegirCuenta(c: CuentaCorriente, conservar = false) {
    this.ccCuenta = c;
    if (!conservar) {
      this.ccMonto = c.saldo;
      this.ccLineas = [{ metodo: null, monto: null }];
      this.ccPagaCon = null;
      this.ccPorcentajeEfectivo = null;
      this.ccDetalleTarjeta = '';
      this.ccCajeroId = null;
    }
    this.ccPendientes = [];
    this.ccCargandoDetalle = true;
    try {
      // Datos actuales (la lista pudo quedar vieja)
      const [cuenta, pendientes] = await Promise.all([
        this.cuentasCorrientes.obtenerCuenta(c.id),
        this.cuentasCorrientes.comprasPendientes(c.id)
      ]);
      if (cuenta) {
        this.ccCuenta = cuenta;
        if (!conservar && this.ccMonto === c.saldo) this.ccMonto = cuenta.saldo;
      }
      this.ccPendientes = pendientes;
    } catch (err: any) {
      console.error('Error leyendo la cuenta corriente:', err);
      Swal.fire('Error', 'No se pudo leer la cuenta del cliente. ' + (err?.message || ''), 'error');
    } finally {
      this.ccCargandoDetalle = false;
    }
  }

  volverAListaCuentas() {
    if (this.ccCobrando) return;
    this.ccCuenta = null;
    this.ccPendientes = [];
  }

  /** ¿Paga (una parte) en efectivo? → se puede cargar un % de descuento */
  get ccPagaEnEfectivo(): boolean {
    return this.ccLineas.some(l => l.metodo === 'efectivo');
  }

  /** % de descuento en efectivo que se aplica (0 si no corresponde o es inválido) */
  get ccPorcentajeAplicado(): number {
    const p = Number(this.ccPorcentajeEfectivo);
    return this.ccPagaEnEfectivo && p > 0 && p < 100 ? Math.round(p * 100) / 100 : 0;
  }

  get ccPorcentajeInvalido(): boolean {
    const p = this.ccPorcentajeEfectivo;
    return this.ccPagaEnEfectivo && p !== null && p !== undefined && String(p) !== '' && (Number(p) < 0 || Number(p) >= 100);
  }

  /**
   * Reparto entre los medios. ccMonto = deuda que se cancela.
   * La parte en efectivo puede tener un % de descuento: paga menos y cancela lo mismo.
   */
  get ccPagos() {
    const pct = this.ccPorcentajeAplicado;
    return calcularPagos(Number(this.ccMonto) || 0, this.ccLineas, m => m === 'efectivo' ? pct : 0);
  }

  /** Lo que efectivamente paga el cliente (con el descuento) */
  get ccTotalAPagar(): number {
    const r = this.ccPagos;
    return r.error ? (Number(this.ccMonto) || 0) : r.totalFinal;
  }

  /** A qué compras se imputa el pago (las más viejas primero) */
  get ccImputacion() {
    const monto = Number(this.ccMonto) || 0;
    return imputarFIFO(this.ccPendientes.map(m => ({
      id: m.id, fecha: m.fecha, pendiente: Number(m.pendiente) || 0, nroTicket: m.nroTicket
    })), monto > 0 ? monto : 0);
  }

  nroTicketTexto(n: any): string {
    return n ? String(n).padStart(8, '0') : 'S/N';
  }

  ccAplicadoA(m: MovimientoCuenta): number {
    return this.ccImputacion.aplicaciones.find(a => a.cargoId === m.id)?.importe || 0;
  }

  get ccMontoEfectivo(): number {
    const r = this.ccPagos;
    if (r.error) return 0;
    return Math.round(r.pagos.filter(p => p.metodo === 'efectivo').reduce((a, p) => a + p.monto, 0) * 100) / 100;
  }

  get ccVuelto(): number | null {
    return this.calcularVuelto(this.ccMontoEfectivo, this.ccPagaCon);
  }

  get ccFaltaEfectivo(): number {
    return this.calcularFalta(this.ccMontoEfectivo, this.ccPagaCon);
  }

  get ccSugerenciasPagaCon(): number[] {
    return this.sugerirBilletes(this.ccMontoEfectivo);
  }

  get ccCobroValido(): boolean {
    if (!this.ccCuenta || this.ccCargandoDetalle || this.ccPagos.error || !this.cajeroSeleccionado(this.ccCajeroId)) return false;
    if (this.ccPorcentajeInvalido) return false;
    if (this.ccFaltaEfectivo > 0) return false;
    const monto = Number(this.ccMonto);
    return monto > 0 && monto <= this.ccCuenta.saldo + 0.009;
  }

  async confirmarCobroCuenta() {
    if (!this.cajaActiva || !this.ccCobroValido || this.ccCobrando || !this.ccCuenta) return;

    const cuenta = this.ccCuenta;
    const monto = Math.round(Number(this.ccMonto) * 100) / 100;
    const pagos = conDetalleTarjeta(this.ccPagos.pagos, this.ccDetalleTarjeta);
    const cajero = this.cajeroSeleccionado(this.ccCajeroId) as Cajero;
    const texto = pagos.length === 1
      ? nombreMetodo(pagos[0].metodo) + this.textoOperacion(pagos[0])
      : pagos.map(p => `${nombreMetodo(p.metodo)} ${this.formatearMoneda(p.monto)}${this.textoOperacion(p)}`).join(' + ');
    const restante = Math.round((cuenta.saldo - monto) * 100) / 100;
    const descuento = this.ccPagos.descuentoTotal;
    const aPagar = this.ccPagos.totalFinal;

    const r = await Swal.fire({
      title: 'Confirmar cobro',
      html: `Cuenta corriente de <strong>${this.escaparHtml(cuenta.nombre)}</strong><br>
             ${descuento > 0 ? `<small>Cancela ${this.formatearMoneda(monto)} de deuda · descuento ${this.ccPorcentajeAplicado}% en efectivo: -${this.formatearMoneda(descuento)}</small><br>` : ''}
             <span style="font-size:22px">${this.formatearMoneda(aPagar)}</span><br><small>${texto}</small><br>
             <small>Cobra: <strong>${this.escaparHtml(nombreCajero(cajero))}</strong></small><br>
             ${this.ccVuelto !== null ? `<div style="font-size:15px;margin-top:4px">Paga con ${this.formatearMoneda(this.ccPagaCon as number)} · <strong>Vuelto: ${this.formatearMoneda(this.ccVuelto)}</strong></div>` : ''}
             <div style="margin-top:6px">${restante > 0.004
               ? `Pago parcial: la deuda queda en <strong>${this.formatearMoneda(restante)}</strong>`
               : '<strong>Cancela toda la deuda</strong>'}</div>`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Cobrar',
      cancelButtonText: 'Volver'
    });
    if (!r.isConfirmed) return;

    this.ccCobrando = true;
    try {
      const res = await this.cuentasCorrientes.cobrar(
        this.cajaActiva,
        { id: cuenta.id, nombre: cuenta.nombre, dni: cuenta.dni },
        pagos,
        cajeroParaVenta(cajero),
        { efectivoRecibido: this.ccVuelto !== null ? this.ccPagaCon : null, vuelto: this.ccVuelto }
      );

      this.mostrarCobroCuenta = false;
      // Si es el cliente de la venta en curso, se actualiza su deuda
      if (this.clienteActual?.id === cuenta.id) this.clienteActual.saldoCuenta = res.saldoRestante;

      const fin = await Swal.fire({
        title: `✅ Cobro registrado · Ticket Nº ${this.tickets.numeroFormateado(res.venta)}`,
        html: (res.venta.vuelto !== null && res.venta.vuelto !== undefined
            ? `<div style="font-size:22px;margin-bottom:8px">Vuelto: <strong>${this.formatearMoneda(res.venta.vuelto)}</strong></div>`
            : '') +
          (res.saldoRestante > 0.004
            ? `Deuda pendiente de ${this.escaparHtml(cuenta.nombre)}: <strong>${this.formatearMoneda(res.saldoRestante)}</strong>`
            : `La cuenta de ${this.escaparHtml(cuenta.nombre)} quedó <strong>sin deuda</strong>.`),
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
      if (err instanceof CuentaCorrienteError) {
        await Swal.fire('No se pudo cobrar', err.message, 'warning');
        if (err.message.startsWith('La caja está cerrada')) {
          this.mostrarCobroCuenta = false;
          this.cajaService.clearCajaActiva();
          this.cajaActiva = null;
          this.selectedSucursal = null;
        } else if (this.ccCuenta) {
          await this.elegirCuenta(this.ccCuenta, true);   // se vuelve a leer la cuenta
        }
      } else {
        console.error('Error cobrando cuenta corriente:', err);
        await Swal.fire('Error', 'No se pudo registrar el cobro. ' + (err?.message || ''), 'error');
      }
    } finally {
      this.ccCobrando = false;
    }
  }

  // =====================================================
  // 🏠 COBRO DE CUOTAS DEL CRÉDITO DE LA CASA
  // =====================================================

  mostrarCobroCuota = false;
  cuCargando = false;
  cuCreditos: Credito[] = [];                         // vigentes (con saldo)
  cuSituaciones: { [id: string]: SituacionCredito } = {};
  cuFiltro = '';
  cuCredito: Credito | null = null;                   // crédito elegido
  cuPagosAnteriores: PagoCredito[] = [];
  cuCargandoDetalle = false;
  cuMonto: number | null = null;                      // lo que se aplica a las cuotas
  cuRecargo: number | null = null;                    // recargo por mora: lo que escribió el cajero
  cuRecargoEditado = false;                           // false = se usa el calculado (1% por día corrido)
  readonly recargoDiario = RECARGO_DIARIO;
  cuLineas: LineaPago[] = [{ metodo: null, monto: null }];
  cuPagaCon: number | null = null;
  cuDetalleTarjeta = '';
  cuCajeroId: string | null = null;
  cuCobrando = false;
  // 🔁 Refinanciación (en la misma ventana, con el crédito elegido)
  cuModo: 'cobro' | 'refinanciar' = 'cobro';
  rfRecargo: number | null = null;
  rfRecargoEditado = false;
  rfEntrega: number | null = null;
  rfCuotas: number | null = null;
  rfLineas: LineaPago[] = [{ metodo: null, monto: null }];
  rfDetalleTarjeta = '';
  rfProcesando = false;
  readonly estadoCuota = estadoCuota;
  readonly estaBloqueado = estaBloqueado;
  readonly ultimaCarta = ultimaCarta;
  readonly fechaCorta = fechaCorta;
  readonly faltaCuota = faltaCuota;

  async abrirCobroCuota() {
    if (!this.cajaActiva) return;
    this.mostrarCobroCuota = true;
    this.cuFiltro = '';
    this.cuCredito = null;
    await this.cargarCreditosVigentes();
    // Si el cliente de la venta en curso tiene un solo crédito, se elige directo
    const delCliente = this.clienteActual ? this.cuCreditos.filter(c => c.cliente?.id === this.clienteActual!.id) : [];
    if (delCliente.length === 1) await this.elegirCredito(delCliente[0]);
    else if (delCliente.length > 1) this.cuFiltro = String(this.clienteActual?.dni || this.clienteActual?.nombre || '');
  }

  cerrarCobroCuota() {
    if (this.cuCobrando) return;
    this.mostrarCobroCuota = false;
  }

  private async cargarCreditosVigentes() {
    this.cuCargando = true;
    try {
      const lista = await this.creditos.vigentes();
      const hoy = new Date();
      this.cuSituaciones = {};
      lista.forEach(c => this.cuSituaciones[c.id] = situacionCredito(c, hoy));
      // Primero los atrasados (el más atrasado arriba), después por nombre
      const orden = { vencido: 0, 'por-vencer': 1, 'al-dia': 2, cancelado: 3 } as const;
      this.cuCreditos = lista.sort((a, b) => {
        const sa = this.cuSituaciones[a.id], sb = this.cuSituaciones[b.id];
        return orden[sa.estado] - orden[sb.estado] || sb.diasAtraso - sa.diasAtraso
          || String(a.cliente?.nombre).localeCompare(String(b.cliente?.nombre), 'es');
      });
    } catch (err: any) {
      console.error('Error cargando créditos:', err);
      Swal.fire('Error', 'No se pudieron cargar los créditos. ' + (err?.message || ''), 'error');
    } finally {
      this.cuCargando = false;
    }
  }

  get cuCreditosFiltrados(): Credito[] {
    const palabras = BuscadorClientesService.normalizar(this.cuFiltro).split(' ').filter(Boolean);
    if (!palabras.length) return this.cuCreditos;
    return this.cuCreditos.filter(c => {
      const texto = BuscadorClientesService.normalizar(
        `${c.cliente?.nombre} ${c.cliente?.dni ?? ''} ${c.cliente?.telefono ?? ''} ${(c.equipos || []).map(e => e.nombre + ' ' + e.imei).join(' ')} ${c.nroTicket ?? ''}`);
      return palabras.every(p => texto.includes(p));
    });
  }

  /** @param conservar true = vuelve a leer el crédito sin borrar lo cargado (monto, medios, cajero) */
  async elegirCredito(c: Credito, conservar = false) {
    this.cuCredito = c;
    this.cuModo = 'cobro';
    this.limpiarRefinanciacion();
    if (!conservar) {
      this.cuMonto = null;
      this.cuRecargo = null;
      this.cuRecargoEditado = false;
      this.cuLineas = [{ metodo: null, monto: null }];
      this.cuPagaCon = null;
      this.cuDetalleTarjeta = '';
      this.cuCajeroId = null;
    }
    this.cuPagosAnteriores = [];
    this.cuCargandoDetalle = true;
    try {
      const [actual, pagos] = await Promise.all([this.creditos.obtener(c.id), this.creditos.pagosDe(c.id)]);
      if (actual) this.cuCredito = actual;
      this.cuPagosAnteriores = pagos;
      if (!conservar && this.cuCredito) {
        // Sugerido: lo vencido + la cuota del mes; si no, la próxima cuota
        const s = situacionCredito(this.cuCredito);
        this.cuMonto = s.aPagarHoy > 0 ? s.aPagarHoy : (s.proxima ? faltaCuota(s.proxima) : null);
      }
    } catch (err: any) {
      console.error('Error leyendo el crédito:', err);
      Swal.fire('Error', 'No se pudo leer el crédito. ' + (err?.message || ''), 'error');
    } finally {
      this.cuCargandoDetalle = false;
    }
  }

  // =====================================================
  // 🔁 REFINANCIACIÓN
  // =====================================================

  private limpiarRefinanciacion() {
    this.rfRecargo = null;
    this.rfRecargoEditado = false;
    this.rfEntrega = null;
    this.rfCuotas = null;
    this.rfLineas = [{ metodo: null, monto: null }];
    this.rfDetalleTarjeta = '';
  }

  cambiarModoCuota(modo: 'cobro' | 'refinanciar') {
    if (this.cuCobrando || this.rfProcesando) return;
    this.cuModo = modo;
    if (modo === 'refinanciar') this.cargarPlanesCredito();
  }

  /** Recargo sugerido: el de todas las cuotas vencidas (1% por día corrido) */
  get rfRecargoSugerido() {
    return recargoRefinanciacion(this.cuCredito?.cuotas || [], new Date());
  }

  get rfRecargoValor(): number | null {
    if (this.rfRecargoEditado) return this.rfRecargo;
    const t = this.rfRecargoSugerido.total;
    return t > 0 ? t : null;
  }

  cambiarRecargoRefinanciacion(v: any) {
    this.rfRecargo = v === '' || v === undefined ? null : v;
    this.rfRecargoEditado = true;
  }

  recalcularRecargoRefinanciacion() {
    this.rfRecargo = null;
    this.rfRecargoEditado = false;
  }

  /** Cálculo con un plan (para mostrar el valor de la cuota de cada uno) */
  calculoRefinanciacion(cuotas: number | null): { calculo: CalculoRefinanciacion | null; error: string | null } {
    const plan = this.planesCredito.find(p => p.cuotas === cuotas) || null;
    return calcularRefinanciacion(this.cuSituacion?.saldo || 0, this.rfRecargoValor, this.rfEntrega, plan, new Date());
  }

  cuotaRefinanciacion(cuotas: number): number | null {
    return this.calculoRefinanciacion(cuotas).calculo?.cuotas[0]?.importe ?? null;
  }

  get rfResultado() {
    return this.calculoRefinanciacion(this.rfCuotas);
  }

  get rfEntregaValor(): number {
    const e = Number(this.rfEntrega);
    return e > 0 ? Math.round(e * 100) / 100 : 0;
  }

  /** Reparto de la entrega entre los medios */
  get rfPagos() {
    return calcularPagos(this.rfEntregaValor, this.rfLineas, () => 0);
  }

  get rfError(): string | null {
    if (!this.cuCredito || this.cuCargandoDetalle) return null;
    const r = this.rfResultado;
    if (r.error) return r.error;
    if (this.rfEntregaValor > 0 && this.rfPagos.error) return this.rfPagos.error;
    if (!this.cajeroSeleccionado(this.cuCajeroId)) return 'Elegí el cajero.';
    return null;
  }

  async confirmarRefinanciacion() {
    const credito = this.cuCredito;
    const r = this.rfResultado;
    if (!this.cajaActiva || !credito || !r.calculo || this.rfError || this.rfProcesando) return;
    const c = r.calculo;
    const cajero = this.cajeroSeleccionado(this.cuCajeroId) as Cajero;
    const pagos = this.rfEntregaValor > 0 ? conDetalleTarjeta(this.rfPagos.pagos, this.rfDetalleTarjeta) : [];
    const ok = await Swal.fire({
      title: '¿Refinanciar el crédito?',
      html: `<div style="text-align:left">${this.escaparHtml(credito.cliente.nombre)}<br>
        Saldo ${this.formatearMoneda(c.saldo)}${c.recargo > 0 ? ` + recargo ${this.formatearMoneda(c.recargo)}` : ''}${c.entrega > 0 ? ` − entrega ${this.formatearMoneda(c.entrega)}` : ''}
        = <strong>${this.formatearMoneda(c.aRefinanciar)}</strong><br>
        <span style="font-size:20px"><strong>${c.cuotas.length} cuota${c.cuotas.length > 1 ? 's' : ''} de ${this.formatearMoneda(c.cuotas[0].importe)}</strong></span>
        ${c.cuotas.length > 1 && c.cuotas[c.cuotas.length - 1].importe !== c.cuotas[0].importe ? `<br><small>(la última de ${this.formatearMoneda(c.cuotas[c.cuotas.length - 1].importe)})</small>` : ''}
        <br><small>Total financiado ${this.formatearMoneda(c.financiado)} · vencen del 1 al 10 desde ${mesCuota(c.cuotas[0])}</small>
        ${c.entrega > 0 ? `<br><br>Cobra la entrega: <strong>${this.formatearMoneda(c.entrega)}</strong> (${pagos.map(p => nombreMetodo(p.metodo)).join(' + ')})` : ''}
        ${estaBloqueado(credito) ? '<br><br><small>🔒 El crédito nuevo sigue bloqueado (carta documento).</small>' : ''}
        <br><br><small>El crédito actual queda como <strong>refinanciado</strong> y se crea uno nuevo con este plan.</small></div>`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Refinanciar',
      cancelButtonText: 'Volver'
    });
    if (!ok.isConfirmed) return;

    this.rfProcesando = true;
    try {
      const plan = this.planesCredito.find(p => p.cuotas === this.rfCuotas)!;
      const res = await this.creditos.refinanciar(this.cajaActiva, credito.id,
        { recargo: c.recargo, entrega: c.entrega, plan, pagos, cajero: cajeroParaVenta(cajero) });
      this.limpiarRefinanciacion();
      this.cuModo = 'cobro';
      this.cuCredito = null;
      this.cuPagosAnteriores = [];
      await this.cargarCreditosVigentes();
      const fin = await Swal.fire({
        title: `🔁 Crédito refinanciado · Ticket Nº ${this.tickets.numeroFormateado(res.venta)}`,
        html: `${c.cuotas.length} cuota${c.cuotas.length > 1 ? 's' : ''} de <strong>${this.formatearMoneda(c.cuotas[0].importe)}</strong>.<br>
               <small>Imprimí el comprobante para que el cliente firme el nuevo plan.</small>`,
        icon: 'success',
        showCancelButton: true,
        showDenyButton: true,
        confirmButtonText: '🖨 Imprimir',
        denyButtonText: 'Ver',
        cancelButtonText: 'Cerrar'
      });
      if (fin.isConfirmed) this.tickets.abrir(res.venta, 'imprimir');
      else if (fin.isDenied) this.tickets.abrir(res.venta, 'vista');
    } catch (err: any) {
      if (err instanceof CreditoError) {
        await Swal.fire('No se pudo refinanciar', err.message, 'warning');
      } else {
        console.error('Error refinanciando:', err);
        await Swal.fire('Error', 'No se pudo refinanciar. ' + (err?.message || ''), 'error');
      }
    } finally {
      this.rfProcesando = false;
    }
  }

  volverAListaCreditos() {
    if (this.cuCobrando || this.rfProcesando) return;
    this.cuCredito = null;
    this.cuPagosAnteriores = [];
  }

  get cuSituacion(): SituacionCredito | null {
    return this.cuCredito ? situacionCredito(this.cuCredito) : null;
  }

  /** Recargo calculado: 1% del importe de cada cuota vencida que se paga, por día de atraso (corrido) */
  get cuRecargoSugerido() {
    const numeros = this.cuImputacion.aplicaciones.map(a => a.numero);
    return recargoPorAtraso(this.cuCredito?.cuotas || [], numeros, new Date());
  }

  /** Lo que va en el campo: el calculado, salvo que el cajero lo haya cambiado */
  get cuRecargoValor(): number | null {
    if (this.cuRecargoEditado) return this.cuRecargo;
    const t = this.cuRecargoSugerido.total;
    return t > 0 ? t : null;
  }

  cambiarRecargo(v: any) {
    this.cuRecargo = v === '' || v === undefined ? null : v;
    this.cuRecargoEditado = true;
  }

  recalcularRecargo() {
    this.cuRecargo = null;
    this.cuRecargoEditado = false;
  }

  get cuRecargoInvalido(): boolean {
    const v = this.cuRecargoValor;
    return v !== null && v !== undefined && String(v) !== '' && !(Number(v) >= 0);
  }

  /** Lo que paga el cliente: cuotas + recargo */
  get cuTotal(): number {
    const recargo = this.cuRecargoInvalido ? 0 : Number(this.cuRecargoValor) || 0;
    return Math.round(((Number(this.cuMonto) || 0) + recargo) * 100) / 100;
  }

  /** Reparto entre los medios (sin descuentos) */
  get cuPagos() {
    return calcularPagos(this.cuTotal, this.cuLineas, () => 0);
  }

  /** A qué cuotas se aplica el pago (la más vieja primero) */
  get cuImputacion() {
    const monto = Number(this.cuMonto) || 0;
    return imputarCuotas(this.cuCredito?.cuotas || [], monto > 0 ? monto : 0);
  }

  cuAplicadoA(numero: number): number {
    return this.cuImputacion.aplicaciones.find(a => a.numero === numero)?.importe || 0;
  }

  get cuMontoEfectivo(): number {
    const r = this.cuPagos;
    if (r.error) return 0;
    return Math.round(r.pagos.filter(p => p.metodo === 'efectivo').reduce((a, p) => a + p.monto, 0) * 100) / 100;
  }

  get cuVuelto(): number | null {
    return this.calcularVuelto(this.cuMontoEfectivo, this.cuPagaCon);
  }

  get cuFaltaEfectivo(): number {
    return this.calcularFalta(this.cuMontoEfectivo, this.cuPagaCon);
  }

  get cuSugerenciasPagaCon(): number[] {
    return this.sugerirBilletes(this.cuMontoEfectivo);
  }

  get cuCobroValido(): boolean {
    if (!this.cuCredito || this.cuCargandoDetalle || this.cuPagos.error || !this.cajeroSeleccionado(this.cuCajeroId)) return false;
    if (this.cuRecargoInvalido || this.cuFaltaEfectivo > 0) return false;
    const monto = Number(this.cuMonto);
    return monto > 0 && monto <= (this.cuSituacion?.saldo || 0) + 0.009;
  }

  async confirmarCobroCuota() {
    if (!this.cajaActiva || !this.cuCobroValido || this.cuCobrando || !this.cuCredito) return;

    const credito = this.cuCredito;
    const monto = Math.round(Number(this.cuMonto) * 100) / 100;
    const recargo = this.cuRecargoInvalido ? 0 : Math.round((Number(this.cuRecargoValor) || 0) * 100) / 100;
    const pagos = conDetalleTarjeta(this.cuPagos.pagos, this.cuDetalleTarjeta);
    const cajero = this.cajeroSeleccionado(this.cuCajeroId) as Cajero;
    const texto = pagos.length === 1
      ? nombreMetodo(pagos[0].metodo) + this.textoOperacion(pagos[0])
      : pagos.map(p => `${nombreMetodo(p.metodo)} ${this.formatearMoneda(p.monto)}${this.textoOperacion(p)}`).join(' + ');
    const restante = Math.round(((this.cuSituacion?.saldo || 0) - monto) * 100) / 100;
    const cuotas = this.cuImputacion.aplicaciones
      .map(a => `Cuota ${a.numero}: ${this.formatearMoneda(a.importe)}${a.pendienteNuevo > 0.004 ? ` (queda ${this.formatearMoneda(a.pendienteNuevo)})` : ''}`)
      .join('<br>');

    const r = await Swal.fire({
      title: 'Confirmar cobro de cuotas',
      html: `Crédito de <strong>${this.escaparHtml(credito.cliente?.nombre)}</strong><br>
             <small>${cuotas}</small><br>
             ${recargo > 0 ? `<small>Recargo fuera de término: ${this.formatearMoneda(recargo)}</small><br>` : ''}
             <span style="font-size:22px">${this.formatearMoneda(monto + recargo)}</span><br><small>${texto}</small><br>
             <small>Cobra: <strong>${this.escaparHtml(nombreCajero(cajero))}</strong></small><br>
             ${this.cuVuelto !== null ? `<div style="font-size:15px;margin-top:4px">Paga con ${this.formatearMoneda(this.cuPagaCon as number)} · <strong>Vuelto: ${this.formatearMoneda(this.cuVuelto)}</strong></div>` : ''}
             <div style="margin-top:6px">${restante > 0.004
               ? `El crédito queda debiendo <strong>${this.formatearMoneda(restante)}</strong>`
               : '<strong>Cancela todo el crédito</strong>'}</div>`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Cobrar',
      cancelButtonText: 'Volver'
    });
    if (!r.isConfirmed) return;

    this.cuCobrando = true;
    try {
      const res = await this.creditos.cobrar(
        this.cajaActiva, credito.id, monto, recargo, pagos, cajeroParaVenta(cajero),
        { efectivoRecibido: this.cuVuelto !== null ? this.cuPagaCon : null, vuelto: this.cuVuelto }
      );
      this.mostrarCobroCuota = false;

      const fin = await Swal.fire({
        title: `✅ Cobro registrado · Ticket Nº ${this.tickets.numeroFormateado(res.venta)}`,
        html: (res.venta.vuelto !== null && res.venta.vuelto !== undefined
            ? `<div style="font-size:22px;margin-bottom:8px">Vuelto: <strong>${this.formatearMoneda(res.venta.vuelto)}</strong></div>`
            : '') +
          (res.cancelado
            ? `🎉 El crédito de ${this.escaparHtml(credito.cliente?.nombre)} quedó <strong>cancelado</strong>.`
            : `Saldo del crédito de ${this.escaparHtml(credito.cliente?.nombre)}: <strong>${this.formatearMoneda(res.saldoRestante)}</strong>`) +
          '<div class="small text-muted mt-2">El comprobante queda guardado: se reimprime desde Tickets o desde el crédito.</div>',
        icon: 'success',
        showCancelButton: true,
        showDenyButton: true,
        confirmButtonText: '🖨 Imprimir comprobante',
        denyButtonText: 'Ver comprobante',
        cancelButtonText: 'Cerrar'
      });
      if (fin.isConfirmed) this.tickets.abrir(res.venta, 'imprimir');
      else if (fin.isDenied) this.tickets.abrir(res.venta, 'vista');

    } catch (err: any) {
      if (err instanceof CreditoError) {
        await Swal.fire('No se pudo cobrar', err.message, 'warning');
        if (err.message.startsWith('La caja está cerrada')) {
          this.mostrarCobroCuota = false;
          this.cajaService.clearCajaActiva();
          this.cajaActiva = null;
          this.selectedSucursal = null;
        } else if (this.cuCredito) {
          await this.elegirCredito(this.cuCredito, true);   // se vuelve a leer el crédito
        }
      } else {
        console.error('Error cobrando cuotas:', err);
        await Swal.fire('Error', 'No se pudo registrar el cobro. ' + (err?.message || ''), 'error');
      }
    } finally {
      this.cuCobrando = false;
    }
  }

  cuotasDePago(p: PagoCredito): string {
    return (p.aplicaciones || []).map(a => a.numero).join(', ');
  }

  /** Comprobante de un pago anterior (o el ticket de la compra) */
  async reimprimirComprobante(ventaId: string) {
    try {
      const venta = await this.creditos.ticket(ventaId);
      if (!venta) {
        await Swal.fire('Comprobante', 'No se encontró el ticket.', 'warning');
        return;
      }
      this.tickets.abrir(venta, 'vista');
    } catch (err: any) {
      Swal.fire('Error', 'No se pudo abrir el comprobante. ' + (err?.message || ''), 'error');
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
    const contado = this.calcularResumenContado();
    return this.ventaCredito ? this.aplicarCredito(contado) : contado;
  }

  /** Venta común (de contado), con el plan canje si lo usa */
  private calcularResumenContado(): ResumenVenta {
    const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
    const subtotal = this.total || 0;

    // 📱 Equipos: no llevan descuentos automáticos (cupón, puntos, efectivo / transferencia).
    // Solo el % manual que ponga el cajero para los equipos.
    const subtotalEquipos = r2(this.carrito.filter(i => !!i.equipoId).reduce((a, i) => a + (Number(i.subtotal) || 0), 0));
    const subtotalProductos = r2(Math.max(0, subtotal - subtotalEquipos));
    const porcentajeEquipos = subtotalEquipos > 0 ? this.porcentajeEquiposAplicado : 0;
    const descuentoEquipos = r2(subtotalEquipos * porcentajeEquipos / 100);
    const baseEquipos = r2(subtotalEquipos - descuentoEquipos);
    const errorEquipos = subtotalEquipos > 0 && this.descuentoEquiposInvalido
      ? 'El descuento de equipos tiene que ser entre 0 y 99%.'
      : this.hayEquiposEnDolares && this.dolarEquiposInvalido ? 'Ingresá el valor del dólar para los equipos.' : null;

    if (!this.aplicanDescuentos) {
      // Mayorista: sin descuentos, pero puede dividir el pago igual
      const totalBase = r2(subtotalProductos + baseEquipos);
      const pago = this.pagosConCanje(totalBase, () => 0);
      if (!pago.error && this.lineasPago.some(l => l.metodo === 'cuentacorriente') && !this.puedeUsarCuentaCorriente) {
        pago.error = 'La cuenta corriente es solo para clientes mayoristas identificados.';
      }
      if (!pago.error && errorEquipos) pago.error = errorEquipos;
      return {
        subtotal, aplicaDescuentos: false,
        descuentoCupon: 0, puntosUsados: 0, descuentoPuntos: 0,
        subtotalEquipos, porcentajeEquipos, descuentoEquipos,
        totalBase, porcentajePago: 0, descuentoPago: 0,
        pagos: pago.pagos, errorPago: pago.error,
        totalFinal: totalBase, puntosASumar: 0,
        canje: pago.canje, credito: null
      };
    }

    // Cupón y puntos: solo sobre los productos
    let total = subtotalProductos;

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

    const baseProductos = total;
    const totalBase = r2(baseProductos + baseEquipos);

    // 3) Medio(s) de pago: cada parte lleva el descuento de su medio (proporcional),
    //    pero SOLO sobre los productos: con equipos en el carrito el % se aplica a la parte de productos.
    const proporcionProductos = totalBase > 0 ? baseProductos / totalBase : 0;
    const pago = this.pagosConCanje(totalBase, m => this.porcentajeDeMetodo(m) * proporcionProductos);
    if (!pago.error && this.mediosConDescuento.some(m => this.descuentoInvalido(m))) {
      pago.error = 'El descuento por medio de pago tiene que ser entre 0 y 99%.';
    }
    if (!pago.error && errorEquipos) pago.error = errorEquipos;
    // Para mostrar (confirmación, ticket): el % del medio, no el efectivo sobre el total
    const pagos = pago.pagos.map(p => ({ ...p, porcentajeDescuento: p.descuento > 0 ? this.porcentajeDeMetodo(p.metodo) : 0 }));
    const descuentoPago = pago.error ? 0 : pago.descuentoTotal;
    const totalFinal = pago.error ? totalBase : pago.totalFinal;
    const porcentajePago = !pago.error && pagos.length === 1 ? pagos[0].porcentajeDescuento : 0;

    // 4) Puntos a sumar: sobre lo que efectivamente paga por los productos (los equipos no suman)
    const pagaProductos = Math.max(0, baseProductos - descuentoPago);
    const puntosASumar = this.puedeUsarPuntos && this.valorParaSumarPunto > 0
      ? Math.floor(pagaProductos / this.valorParaSumarPunto)
      : 0;

    return {
      subtotal, aplicaDescuentos: true,
      descuentoCupon, puntosUsados, descuentoPuntos,
      subtotalEquipos, porcentajeEquipos, descuentoEquipos,
      totalBase, porcentajePago, descuentoPago,
      pagos, errorPago: pago.error,
      totalFinal, puntosASumar,
      canje: pago.canje, credito: null
    };
  }

  // =====================================================
  // 📲 PLAN CANJE Y 🏠 CRÉDITO DE LA CASA
  // =====================================================

  /** Pagos de contado: si usa plan canje, el equipo usado va primero y los medios cubren el resto */
  private pagosConCanje(totalBase: number, porcentaje: (m: MetodoPago) => number): ResultadoPagos & { canje: DatosCanje | null } {
    const c = this.validarCanjeActual(this.usaCanje && this.hayEquiposEnCarrito, totalBase);
    if (!c.canje && c.error) {
      return { pagos: [], descuentoTotal: 0, totalFinal: totalBase, resto: 0, error: c.error, canje: null };
    }
    const lineas: LineaPago[] = c.canje ? [{ metodo: 'canje', monto: c.canje.monto }, ...this.lineasPago] : this.lineasPago;
    const pago = calcularPagos(totalBase, lineas, m => m === 'canje' ? 0 : porcentaje(m));
    if (c.canje && !pago.error) pago.pagos[0] = { ...pago.pagos[0], detalle: c.canje.detalle };
    // Los datos que falten del equipo del canje no cambian los montos, pero no dejan confirmar
    return { ...pago, error: c.error || pago.error, canje: c.canje };
  }

  /**
   * Venta con crédito de la casa: precio financiado − canje − entrega = saldo en cuotas.
   * La entrega se paga con los medios de siempre (sin descuentos). No suma puntos.
   */
  private aplicarCredito(c: ResumenVenta): ResumenVenta {
    const base: ResumenVenta = {
      ...c, porcentajePago: 0, descuentoPago: 0, puntosASumar: 0, pagos: [], canje: null, credito: null, totalFinal: c.totalBase
    };
    const conError = (error: string, extra: Partial<ResumenVenta> = {}): ResumenVenta => ({ ...base, ...extra, errorPago: error });

    if (!this.hayEquiposEnCarrito) return conError('El crédito de la casa es para ventas con al menos un equipo.');
    if (!this.clienteActual?.id) return conError('Buscá al cliente: el crédito de la casa necesita un cliente identificado.');
    if (c.errorPago && /dólar|descuento de equipos/i.test(c.errorPago)) return conError(c.errorPago);

    const vacio = (v: any) => v === null || v === undefined || String(v).trim() === '';
    // El campo "Precio de contado" es sin el canje: el precio del equipo es ese + el canje
    const contado = vacio(this.creditoPrecio) ? c.totalBase : Number(this.creditoPrecio) + this.canjeEnCredito;
    const cj = this.validarCanjeActual(this.usaCanje, contado);
    if (!cj.canje && cj.error) return conError(cj.error);

    // Contado (ajustable) − canje − entrega = a financiar; + interés del plan elegido
    const r = calcularCredito({
      precioLista: c.totalBase,
      precioContado: vacio(this.creditoPrecio) ? '' : contado,
      canje: cj.canje?.monto || 0,
      entrega: this.creditoEntrega,
      cuotas: this.creditoCuotas,
      planes: this.planesCredito,
      fecha: new Date()
    });
    if (!r.calculo) return conError(r.error!, { canje: cj.canje });
    const calc = r.calculo;
    const extra: Partial<ResumenVenta> = { canje: cj.canje, credito: calc, totalFinal: calc.precioFinanciado };
    if (cj.error) return conError(cj.error, extra);   // faltan datos del equipo del canje (los montos ya están)

    const faltan = datosFaltantes({ dni: this.clienteActual.dni, telefono: this.creditoTelefono, direccion: this.creditoDireccion });
    if (faltan.length) return conError(`Faltan datos del cliente para el crédito: ${faltan.join(', ')}.`, extra);

    // Entrega: con los medios de siempre, sin descuentos
    let pagosEntrega: PagoVenta[] = [];
    if (calc.entrega > 0) {
      if (this.lineasPago.some(l => l.metodo === 'cuentacorriente')) {
        return conError('La entrega se paga con efectivo, tarjeta o transferencia.', extra);
      }
      const pe = calcularPagos(calc.entrega, this.lineasPago, () => 0);
      if (pe.error) return conError(`Entrega: ${pe.error}`, extra);
      pagosEntrega = pe.pagos;
    }

    const pagos: PagoVenta[] = [
      ...(cj.canje ? [{ metodo: 'canje' as MetodoPago, monto: cj.canje.monto, porcentajeDescuento: 0, descuento: 0, detalle: cj.canje.detalle }] : []),
      ...pagosEntrega,
      {
        metodo: 'creditocasa', monto: calc.saldo, porcentajeDescuento: 0, descuento: 0,
        detalle: `${calc.cuotas.length} cuota${calc.cuotas.length > 1 ? 's' : ''}`
      }
    ];
    return { ...base, ...extra, pagos, errorPago: null };
  }

  /** En el resumen, los pagos de las líneas que carga el cajero empiezan después del canje */
  get offsetPagos(): number {
    return this.resumen.pagos[0]?.metodo === 'canje' ? 1 : 0;
  }

  /** ¿Hay que mostrar los medios de pago? (con crédito, solo si hay entrega) */
  get mostrarMediosPago(): boolean {
    return !this.ventaCredito || (Number(this.creditoEntrega) || 0) > 0;
  }

  cambiarVentaCredito(activar: boolean) {
    this.ventaCredito = activar;
    this.mostrarErrorPago = false;
    if (activar) {
      // La entrega no se puede pagar a cuenta corriente
      const i = this.lineasPago.findIndex(l => l.metodo === 'cuentacorriente');
      if (i >= 0) {
        if (this.lineasPago.length > 1) this.quitarMedioPago(this.lineasPago, i);
        else this.lineasPago[0].metodo = null;
      }
      if (this.clienteActual) {
        this.creditoTelefono = this.creditoTelefono || this.clienteActual.telefono || '';
        this.creditoDireccion = this.creditoDireccion || this.clienteActual.direccion || '';
      }
      this.cargarPlanesCredito();   // por si los cambiaron en Gestiones
    }
  }

  /** Planes de cuotas e interés (Gestiones → Créditos de la casa) */
  private async cargarPlanesCredito() {
    if (!this.creditos) return;
    const cfg = await this.creditos.planes();
    this.planesCredito = cfg.planes;
    if (this.creditoCuotas !== null && !this.planesCredito.some(p => p.cuotas === this.creditoCuotas)) this.creditoCuotas = null;
  }

  /** Cuánto queda cada cuota de un plan con lo que hay cargado (para los botones) */
  cuotaDePlan(p: PlanCuotas): number | null {
    const aFinanciar = this.contadoConCanje - (Number(this.creditoEntrega) || 0);
    return aFinanciar > 0 ? Math.round(conInteres(aFinanciar, p.interes) / p.cuotas) : null;
  }

  /** Lo que paga el cliente con dinero: sin lo que se le toma por el plan canje (con crédito: entrega + cuotas) */
  get totalAPagar(): number {
    const r = this.resumen;
    const canje = r.canje?.monto || 0;
    const total = r.credito ? r.credito.precioFinanciado - r.credito.canje : r.totalFinal - canje;
    return Math.round(total * 100) / 100;
  }

  /** Lo que se le toma por el equipo del plan canje (0 si no usa) */
  get canjeEnCredito(): number {
    return this.usaCanje ? Math.max(0, Number(this.canjeMonto) || 0) : 0;
  }

  /** Precio de contado con el canje descontado: el cargado a mano o lista − canje */
  get contadoConCanje(): number {
    return this.creditoPrecio !== null && String(this.creditoPrecio) !== ''
      ? Number(this.creditoPrecio)
      : Math.round((this.resumen.totalBase - this.canjeEnCredito) * 100) / 100;
  }

  /** Placeholder del campo (texto) */
  get placeholderContado(): string {
    return String(Math.round((this.resumen.totalBase - this.canjeEnCredito) * 100) / 100);
  }

  restablecerPrecioCredito() {
    this.creditoPrecio = null;
    this.mostrarErrorPago = false;
  }


  // =====================================================
  // 🧮 TASADOR (Plan canje)
  // =====================================================

  async abrirTasador() {
    this.mostrarTasador = true;
    if (this.modelosTasador.length || this.cargandoTasador) return;
    this.cargandoTasador = true;
    try {
      this.modelosTasador = await this.tasador.modelos(true);
    } catch (e) {
      console.error('Error cargando el tasador', e);
      Swal.fire('No se pudo abrir el tasador', 'Revisá la conexión e intentá de nuevo.', 'warning');
      this.mostrarTasador = false;
    } finally {
      this.cargandoTasador = false;
    }
  }

  /** Usa la tasación: completa el importe del canje (en pesos) y el modelo / capacidad de la ficha */
  usarTasacion(r: ResultadoTasacion) {
    this.mostrarTasador = false;
    this.canjeTasacion = r;
    this.canjeMonto = r.totalARS ?? Math.round(r.totalUSD * this.cotizacionEquipos);
    if (!String(this.canjeEquipo.modelo || '').trim()) this.canjeEquipo.modelo = r.modelo.replace(/^iphone\s*/i, '').toUpperCase();
    if (!this.canjeEquipo.capacidad && this.capacidadesCanje.includes(r.capacidad)) this.canjeEquipo.capacidad = r.capacidad;
    if (!this.canjeAlta && !String(this.canjeDetalle || '').trim()) this.canjeDetalle = `${r.modelo} ${r.capacidad}`;
    this.mostrarErrorPago = false;
    const cajero = this.cajeroSeleccionado(this.cajeroId);
    this.tasador.registrar(r, 'despacho', cajero ? cajeroParaVenta(cajero) : null);
  }

  private canjeEquipoVacio(): DatosEquipoCanje {
    return { modelo: '', color: '', capacidad: '', imei: '', bateria: null as any, grado: '', observaciones: '' };
  }

  /** Descripción del canje: con alta, se arma con los datos del equipo; si no, la que escribieron */
  get detalleCanje(): string {
    if (!this.canjeAlta) return this.canjeDetalle;
    const e = this.canjeEquipo;
    const imei = normalizarImei(e.imei);
    return [[e.modelo, e.capacidad, e.color].map(x => String(x || '').trim()).filter(Boolean).join(' '), imei ? `IMEI ${imei}` : '']
      .filter(Boolean).join(' · ');
  }

  /** Errores de la ficha del equipo del canje (solo si se da de alta) */
  get erroresEquipoCanje(): string[] {
    return this.usaCanje && this.canjeAlta && this.hayEquiposEnCarrito ? validarEquipoCanje(this.canjeEquipo) : [];
  }

  /** Aviso (no bloquea) si el IMEI de 15 dígitos no parece válido */
  get avisoImeiCanje(): string {
    const imei = normalizarImei(this.canjeEquipo.imei);
    return /^\d{15}$/.test(imei) && !imeiValido(imei) ? 'Este IMEI no parece válido: revisá los dígitos.' : '';
  }

  /** Plan canje validado (monto + descripción + ficha del equipo si se da de alta) */
  /**
   * Plan canje: si el MONTO es válido, el canje se descuenta aunque falten datos del equipo
   * (así el total se ve bien mientras se completa la ficha); esos faltantes vuelven como error
   * y no dejan confirmar la venta.
   */
  private validarCanjeActual(usa: boolean, total: number): { canje: DatosCanje | null; error: string | null } {
    if (!usa) return { canje: null, error: null };
    const monto = validarCanje(true, this.canjeMonto, 'monto', total);   // solo el monto
    if (!monto.canje) return monto;
    let error: string | null = null;
    if (this.canjeAlta) {
      const errores = validarEquipoCanje(this.canjeEquipo);
      const imei = normalizarImei(this.canjeEquipo.imei);
      if (errores.length) error = `Equipo del plan canje: ${errores.join(' ')}`;
      else if (this.carrito.some(i => i.equipoId && normalizarImei((i.equipo as any)?.imei) === imei)) {
        error = 'El IMEI del equipo del canje es el mismo de un equipo que se está vendiendo.';
      }
    } else {
      error = validarCanje(true, this.canjeMonto, this.canjeDetalle, total).error;
    }
    return { canje: { monto: monto.canje.monto, detalle: this.detalleCanje.trim().slice(0, MAX_DETALLE_CANJE) }, error };
  }

  private reiniciarCreditoYCanje() {
    this.usaCanje = false;
    this.canjeMonto = null;
    this.canjeTasacion = null;
    this.canjeDetalle = '';
    this.canjeAlta = true;
    this.canjeEquipo = this.canjeEquipoVacio();
    this.ventaCredito = false;
    this.creditoPrecio = null;
    this.creditoEntrega = null;
    this.creditoCuotas = null;
    this.creditoTelefono = '';
    this.creditoDireccion = '';
  }

  // =====================================================
  // 💳 MEDIOS DE PAGO (uno o varios)
  // =====================================================

  /** % de descuento de cada medio (solo con lista minorista) */
  porcentajeDeMetodo(m: MetodoPago | null): number {
    if (!this.aplicanDescuentos) return 0;
    if (m === 'efectivo' || m === 'transferencia') {
      const manual = this.descuentoManual[m];
      if (manual !== null && manual !== undefined && String(manual) !== '' && this.porcentajeValido(manual)) {
        return Math.round(Number(manual) * 100) / 100;
      }
    }
    return this.porcentajeConfigurado(m);
  }

  /** % del medio aunque no esté elegido (para el presupuesto) */
  private porcentajeDeMetodoLista(m: 'efectivo' | 'transferencia'): number {
    const manual = this.descuentoManual[m];
    if (manual !== null && manual !== undefined && String(manual) !== '' && this.porcentajeValido(manual)) {
      return Math.round(Number(manual) * 100) / 100;
    }
    return this.porcentajeConfigurado(m);
  }

  /** % definido en Gestiones → Empresa para el medio */
  porcentajeConfigurado(m: MetodoPago | null): number {
    return m === 'efectivo' ? (this.descuentoEfectivo || 0)
      : m === 'transferencia' ? (this.descuentoTransferencia || 0) : 0;
  }

  private porcentajeValido(v: any): boolean {
    const n = Number(v);
    return !isNaN(n) && n >= 0 && n < 100;
  }

  /** Medios elegidos que llevan descuento (para mostrar el % editable) */
  get mediosConDescuento(): ('efectivo' | 'transferencia')[] {
    if (!this.aplicanDescuentos) return [];
    return (['efectivo', 'transferencia'] as const).filter(m => this.lineasPago.some(l => l.metodo === m));
  }

  descuentoModificado(m: 'efectivo' | 'transferencia'): boolean {
    const v = this.descuentoManual[m];
    return v !== null && v !== undefined && String(v) !== '' && Number(v) !== this.porcentajeConfigurado(m);
  }

  descuentoInvalido(m: 'efectivo' | 'transferencia'): boolean {
    const v = this.descuentoManual[m];
    return v !== null && v !== undefined && String(v) !== '' && !this.porcentajeValido(v);
  }

  restablecerDescuento(m: 'efectivo' | 'transferencia') {
    this.descuentoManual[m] = null;
  }

  get pagoDividido(): boolean {
    return this.lineasPago.length > 1;
  }

  /** Cuenta corriente: solo cliente mayorista identificado (comprando con lista mayorista) */
  get puedeUsarCuentaCorriente(): boolean {
    return this.clienteActual?.tipo === 'mayorista' && !!this.clienteActual.id && this.tipoPrecio === 'mayorista';
  }

  /** Parte de la venta que queda a cuenta corriente */
  get montoACuenta(): number {
    const r = this.resumen;
    if (r.errorPago) return 0;
    return Math.round(r.pagos.filter(p => p.metodo === 'cuentacorriente').reduce((a, p) => a + p.monto, 0) * 100) / 100;
  }

  /** Medios para la venta: los de siempre + "Cuenta corriente" si el cliente es mayorista */
  get metodosVenta() {
    // Con crédito de la casa los medios son para la entrega: sin cuenta corriente
    if (this.ventaCredito) return this.metodosPago;
    return this.puedeUsarCuentaCorriente ? [...this.metodosPago, METODO_CUENTA_CORRIENTE] : this.metodosPago;
  }

  /** Si cambió el cliente y ya no corresponde, se saca "Cuenta corriente" de los medios elegidos */
  private quitarCuentaCorrienteSiNoCorresponde() {
    if (this.clienteActual?.tipo === 'mayorista') return;
    const i = this.lineasPago.findIndex(l => l.metodo === 'cuentacorriente');
    if (i < 0) return;
    if (this.lineasPago.length > 1) this.quitarMedioPago(this.lineasPago, i);
    else this.lineasPago[0].metodo = null;
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
  agregarMedioPago(lineas: LineaPago[], metodos = this.metodosPago) {
    if (lineas.length >= metodos.length) return;
    const usados = lineas.map(l => l.metodo);
    const libre = metodos.find(m => !usados.includes(m.valor))?.valor || null;
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

  /** Cajero activo elegido (o null) */
  cajeroSeleccionado(id: string | null): Cajero | null {
    return id ? this.cajeros.find(c => c.id === id) || null : null;
  }

  private escaparHtml(t: any): string {
    return String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as any)[c]);
  }

  /** Medio(s) de un cobro de reparación ya registrado */
  textoPagosCobro(c: any): string {
    return textoPagos({ ...c, total: c.monto }, n => this.formatearMoneda(n));
  }

  /** " (op. 123456)" para mostrar en las confirmaciones (ya escapado) */
  private textoOperacion(p: { detalle?: string } | null | undefined): string {
    return p?.detalle ? ` <span style="color:#666">(${this.escaparHtml(p.detalle)})</span>` : '';
  }

  /** ¿Alguno de los medios elegidos es tarjeta? (muestra el campo de nº de operación) */
  pagaConTarjeta(lineas: LineaPago[]): boolean {
    return lineas.some(l => l.metodo === 'tarjeta');
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
