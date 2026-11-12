import { Component } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, Validators } from '@angular/forms';
import { Cliente } from 'src/app/modules/auth/models/cliente.model';
import { Firestore, collection, doc, getDoc, getDocs, runTransaction } from '@angular/fire/firestore';
import { ClientesService } from 'src/app/shared/services/clientes.service';
import { PedidosService } from 'src/app/shared/services/pedidos.service';
import { GeneralService } from 'src/app/shared/services/general.service';
import { Router } from '@angular/router';
import { CarritoService } from 'src/app/shared/services/carrito.service';
import { Contador } from '../../models/contador.model';
import { Pedido, StockDescontado } from '../../models/pedido.model';
import { ContadorService } from 'src/app/shared/services/contador.service';
import { VouchersPuntosService } from 'src/app/shared/services/vouchers-puntos.service';
import { InfoEmpresa } from 'src/app/shared/models/infoEmpresa.model';
import { InfoEmpresaService } from 'src/app/shared/services/info-empresa.service';
import { SucursalesService } from 'src/app/modules/admin/services/sucursales.service';
import Swal from 'sweetalert2';
import { esItemEquipo, precioListaEquipo, totalCarritoWeb, subtotalesCarrito, detalleEquipo, cotizacionEquipos } from 'src/app/shared/utils/equipos-tienda';
import { AnalyticsService } from 'src/app/shared/services/analytics.service';
import { itemAnalytics } from 'src/app/shared/utils/analytics-tienda';
import { disponibleParaRetiro } from 'src/app/modules/admin/models/sucursal.model';

/** Sucursal de la que se descuenta stock por defecto (envíos a domicilio) */
const SUCURSAL_CENTRAL_ID = 'GtVWr5IHmosOOB8l6u6j';

/** Error de negocio con mensaje apto para mostrar al cliente */
class CheckoutError extends Error {
  constructor(message: string) {
    super(message);
  }
}

/** Error cuando cambió el precio de algún producto desde que se cargó en el carrito */
class PreciosCambiadosError extends CheckoutError {
  constructor(public cambios: CambioPrecio[]) {
    super('Los precios de algunos productos se actualizaron. Revisá el nuevo total antes de confirmar.');
  }
}

interface PrecioVigente {
  precioFinal: number;
  precioOferta: number | null;
  oferta: boolean;
  moneda: string;
}

interface CambioPrecio {
  index: number;
  nombre: string;
  nuevo: PrecioVigente;
}

/**
 * Precio vigente de un ítem según el producto en Firestore.
 * Misma regla que al agregar al carrito: oferta > lista (mayorista/minorista).
 * Si el ítem es una variante embebida (estructura vieja), usa sus precios con fallback al padre.
 */
function calcularPrecioVigente(productoData: any, item: any, esMayorista: boolean): PrecioVigente | null {
  let fuente = productoData;
  if (Array.isArray(productoData?.variantes) && item.codigoBarras) {
    const variante = productoData.variantes.find((v: any) => v.codigoBarras === item.codigoBarras);
    if (variante) {
      fuente = { ...productoData };
      for (const campo of ['precioMinorista', 'precioMayorista', 'precioOferta', 'oferta', 'moneda']) {
        if (variante[campo] != null) fuente[campo] = variante[campo];
      }
    }
  }

  const precio = (fuente.oferta && fuente.precioOferta)
    ? fuente.precioOferta
    : (esMayorista ? fuente.precioMayorista : fuente.precioMinorista);

  const precioNum = Number(precio);
  if (precio == null || isNaN(precioNum)) return null; // sin dato de precio: no tocamos el ítem

  return {
    precioFinal: precioNum,
    precioOferta: fuente.precioOferta ?? null,
    oferta: !!fuente.oferta,
    moneda: fuente.moneda || 'ARS'
  };
}

function precioDistinto(item: any, nuevo: PrecioVigente): boolean {
  return Math.abs((Number(item.precioFinal) || 0) - nuevo.precioFinal) > 0.005
    || (item.moneda || 'ARS') !== nuevo.moneda;
}

/** Normaliza stockSucursales (estructura vieja tipo mapa → array) */
function mapToArray(maybeMap: any): { sucursalId: string; cantidad: number }[] {
  if (!maybeMap) return [];
  if (Array.isArray(maybeMap)) return maybeMap;
  return Object.entries(maybeMap).map(([sucursalId, cantidad]) => ({
    sucursalId,
    cantidad: Number(cantidad) || 0
  }));
}

@Component({
  selector: 'app-checkout',
  templateUrl: './checkout.component.html',
  styleUrls: ['./checkout.component.css']
})
export class CheckoutComponent {
  mail = localStorage.getItem('mail')
  facturacionEnvio: boolean = false
  clientes: any[] = []
  formCheckout: FormGroup
  clienteEncontrado: Cliente
  radioButtonSeleccionado: string = ''
  opcionPagoSeleccionada: string = ''
  mostrarOtraDireccion: boolean = false;
  envioTocado: boolean = false;
  pagoTocado: boolean = false;
  mostrarErrores = false;
  showOpcionesPago: boolean = false
  showAlertaPago: boolean = false
  direccionEditable = false;
  mostrarModal = false;
  contador: Contador[] = []
  usarPuntos: boolean = false;

  puntosAplicados: number = 0;
  valorMonetarioPorPunto: number = 50;
  valorParaSumarPunto: number = 200;

  codigoCupon: string = '';
  cuponAplicado: any = null;
  errorCupon: string = '';

  cuponControl = new FormControl('');
  mensajeCupon: string = '';
  productos: any[] = [];  // asumimos que ya lo estás cargando en el carrito
  total: number = 0;
  cuponInvalido: boolean = false;
  infoEmpresa: InfoEmpresa | null = null;
  montoParaActivar: number = 50000; // Monto mínimo para activar el modo mayorista
  montoMinimoFuturasCompras: number = 0; // Monto mínimo mayorista luego de activado

  procesando: boolean = false; // evita doble envío del pedido
  actualizandoPrecios: boolean = false; // mientras se verifican precios al entrar
  private preciosVerificados: boolean = false;
  nroPedidoConfirmado: number | null = null; // número REAL del pedido guardado

  sucursales: any[] = []; // lista de sucursales disponibles
  sucursalSeleccionada: string = ''; // id de la sucursal seleccionada por el cliente

   // 0 hasta que carga la cotización. (Antes arrancaba en 1: si el cliente confirmaba antes de que cargara,
   // los productos en USD se guardaban "en pesos" sin convertir y el total del pedido quedaba en dólares)
   dolar: number = 0;
   private cotizacionCargada = false;

  constructor(private analytics: AnalyticsService, private infoEmpresaService: InfoEmpresaService, private firestore: Firestore, private fb: FormBuilder, private clienteService: ClientesService, public pedidoService: PedidosService, public generalService: GeneralService, private contadorService: ContadorService, private router: Router, private carritoService: CarritoService, private puntosService: VouchersPuntosService, private sucursalesService: SucursalesService) {

    this.formCheckout = this.fb.group({
      user: ['', [Validators.required]],
      mail: ['', Validators.required],
      telefono: ['', Validators.required],
      domicilioEntrega: ['', Validators.required],
    });
  }

  async ngOnInit() {
    this.getCliente()
    this.infoEmpresaService.obtenerInfoGeneral().subscribe(info => {
      if (info?.dolar) {
        this.dolar = info.dolar;
        this.cotizacionCargada = true;
      }
      this.dolarJC = cotizacionEquipos(info);   // equipos
    });
    this.getContadorPedidos()
    this.getDatosEmpresa()
    this.obtenerSucursales(); // 🔹 cargamos sucursales (antes podía no ejecutarse si fallaba lo de puntos)
    try {
      await this.inicializarValoresPuntos();
    } catch (err) {
      console.error('Error cargando configuración de puntos:', err);
    }
    this.cuponControl.valueChanges.subscribe(() => {
      if (this.cuponInvalido) {
        this.cuponInvalido = false;
        this.mensajeCupon = '';
      }
    });
  }

  obtenerSucursales(): void {
    this.sucursalesService.obtenerSucursales().subscribe(sucs => {
      // Solo las activas y habilitadas para retiro (las internas, como el mayorista, no se muestran)
      this.sucursales = (sucs || []).filter(s => disponibleParaRetiro(s));
      if (this.sucursalSeleccionada && !this.sucursales.some(s => s.id === this.sucursalSeleccionada)) {
        this.sucursalSeleccionada = '';
      }
      // Si hay una sola, ya queda elegida
      if (!this.sucursalSeleccionada && this.sucursales.length === 1) {
        this.sucursalSeleccionada = this.sucursales[0].id;
      }
    });
  }

  async inicializarValoresPuntos() {
    const valores = await this.puntosService.obtenerValoresPuntos();
    if (valores) {
      this.valorParaSumarPunto = valores.valorParaSumarPunto;
      this.valorMonetarioPorPunto = valores.valorMonetarioPorPunto;
    }

    this.puntosAplicados = this.getPuntosAplicados(this.clienteEncontrado);

    const valoresMayoristas = await this.puntosService.obtenerMontosMayoristas();
    if (valoresMayoristas) {
      this.montoParaActivar = valoresMayoristas.minimoPrimeraCompra;
      this.montoMinimoFuturasCompras = valoresMayoristas.minimoFuturasCompras || 0;
    }

  }
  //FUNCION PARA BUSCAR EL CLIENTE LOGUEADO Y  GUARDARLO EN UNA VARIABLE
  getCliente() {
    this.generalService.getCliente().subscribe(cliente => {
      this.clienteEncontrado = cliente;
      if (cliente) {
        if (cliente.id === 'invitado') {
          // El carrito del invitado vive en localStorage (si se recarga /checkout venía vacío)
          if (!cliente.carrito || cliente.carrito.length === 0) {
            const carritoLS = localStorage.getItem('carritoInvitado');
            cliente.carrito = carritoLS ? JSON.parse(carritoLS) : [];
          }
          this.formCheckout.patchValue({
            user: '',
            mail: '',
            telefono: '',
            domicilioEntrega: '',
          });
        } else {
          this.formCheckout.patchValue({
            user: cliente.usuario,
            mail: cliente.mail,
            telefono: cliente.telefono,
            domicilioEntrega: cliente.direccion,
          });
        }

        // 💲 Al entrar al checkout, actualizamos los precios del carrito (una sola vez)
        if (!this.preciosVerificados && cliente.carrito?.length) {
          this.preciosVerificados = true;
          this.actualizarPreciosCarrito(cliente);
          this.analytics.iniciarCompra(this.itemsAnalytics(cliente.carrito));
        }
      }
    });
  }

  /** Recalcula los precios del carrito con los valores actuales de los productos */
  async actualizarPreciosCarrito(cliente: Cliente) {
    this.actualizandoPrecios = true;
    try {
      const esMayorista = !!cliente.esMayorista;
      const cambios: CambioPrecio[] = [];
      const noDisponibles: string[] = [];

      for (let i = 0; i < cliente.carrito.length; i++) {
        const item = cliente.carrito[i];
        // 📱 Equipo: tiene que seguir disponible y con el mismo precio
        if (esItemEquipo(item)) {
          const snapEq = await getDoc(doc(this.firestore, 'Equipos', item.equipoId)).catch(() => null);
          const eq: any = snapEq && snapEq.exists() ? snapEq.data() : null;
          if (!eq || eq.estado !== 'disponible') {
            noDisponibles.push(item.nombre);
            continue;
          }
          const nuevoEq: PrecioVigente = { precioFinal: precioListaEquipo(eq, esMayorista), precioOferta: null, oferta: false, moneda: eq.moneda || 'USD' };
          if (precioDistinto(item, nuevoEq)) cambios.push({ index: i, nombre: item.nombre, nuevo: nuevoEq });
          continue;
        }
        const id = await this.resolverDocIdProducto(item);
        const snap = id ? await getDoc(doc(this.firestore, 'productos', id)) : null;

        if (!snap || !snap.exists()) {
          noDisponibles.push(item.nombre);
          continue;
        }

        const nuevo = calcularPrecioVigente(snap.data(), item, esMayorista);
        if (nuevo && precioDistinto(item, nuevo)) {
          cambios.push({ index: i, nombre: item.nombre, nuevo });
        }
      }

      if (cambios.length) {
        await this.aplicarPreciosNuevos(cliente, cambios);
      }

      if (noDisponibles.length) {
        await Swal.fire(
          'Productos no disponibles',
          `Estos productos ya no están disponibles: ${noDisponibles.join(', ')}. Quitalos del carrito para poder finalizar la compra.`,
          'warning'
        );
      }
    } catch (err) {
      // Si falla (ej. sin conexión), igual se vuelve a validar al confirmar el pedido
      console.error('No se pudieron verificar los precios del carrito:', err);
    } finally {
      this.actualizandoPrecios = false;
    }
  }

  /** Aplica precios nuevos al carrito, lo guarda y avisa al cliente */
  private async aplicarPreciosNuevos(cliente: Cliente, cambios: CambioPrecio[]) {
    const detalle = cambios.map(c => {
      const item = cliente.carrito[c.index];
      const antes = this.getPrecioProducto(item);
      Object.assign(item, c.nuevo);
      const despues = this.getPrecioProducto(item);
      return `<li><strong>${c.nombre}</strong>: ${this.formatearMoneda(antes)} → ${this.formatearMoneda(despues)}</li>`;
    }).join('');

    // Guardamos el carrito actualizado
    try {
      if (cliente.id === 'invitado') {
        localStorage.setItem('carritoInvitado', JSON.stringify(cliente.carrito));
      } else {
        await this.clienteService.actualizarCliente(cliente.id, { carrito: this.limpiarParaFirestore(cliente.carrito) });
      }
    } catch (err) {
      console.error('No se pudo guardar el carrito con precios actualizados:', err);
    }

    await Swal.fire({
      title: 'Precios actualizados',
      html: `Algunos precios cambiaron desde que agregaste los productos:<ul style="text-align:left">${detalle}</ul>`,
      icon: 'info'
    });
  }

  //FUNCION PARA GUARDAR EN ARREGLO EL CONTADOR DE PEDIDOS
  getContadorPedidos() {
    this.contadorService.getContador()
    this.contadorService.contador$.subscribe(data => {
      this.contador = data
    })
  }


  //FUNCION PARA OBTENER LA CANTIDAD TOTAL A PAGAR DEL CARRITO DEL CLIENTE
  // getTotalPrecio(cliente: any): number {
  //   return cliente.carrito.reduce((total: number, prod: any) => total + (prod.precioFinal * prod.cantidad), 0);

  // }

  // getTotalPrecio(cliente: any): number {
  //   console.log('Calculando total para cliente:', cliente);
  //   return (cliente.carrito || []).reduce((total: number, prod: any) => {
  //     let precio = Number(prod.precioFinal) || 0;
  //     if (prod.moneda === 'USD') {
  //       precio *= this.dolar;
  //     }
  //     const cantidad = Number(prod.cantidad) || 0;
  //     return total + (precio * cantidad);
  //   }, 0);
  // }

  //FUNCION PARA MOSTRAR LOS DATOS DE ENVIO
  showEnvio() {
    const cliente = this.clienteEncontrado;

    const esInvitado = cliente.id === 'invitado';

    // Reestablecemos datos según tipo de cliente
    this.formCheckout.patchValue({
      user: esInvitado ? '' : cliente.usuario,
      mail: esInvitado ? '' : cliente.mail,
      telefono: esInvitado ? '' : cliente.telefono,
      domicilioEntrega: this.radioButtonSeleccionado === 'domicilio'
        ? (esInvitado ? '' : cliente.direccion)
        : '' // en caso de retiro, domicilio vacío
    });

    // Configuramos validadores base
    if (esInvitado) {
      this.formCheckout.get('user')?.setValidators(Validators.required);
      this.formCheckout.get('mail')?.setValidators([Validators.required, Validators.email]);
      this.formCheckout.get('telefono')?.setValidators(Validators.required);
    } else {
      this.formCheckout.get('user')?.clearValidators();
      this.formCheckout.get('mail')?.clearValidators();
      this.formCheckout.get('telefono')?.clearValidators();
    }

    // Configuramos validadores según tipo de envío
    if (this.radioButtonSeleccionado === 'domicilio') {
      this.facturacionEnvio = true;
      this.showOpcionesPago = true;
      this.showAlertaPago = false;
      this.opcionPagoSeleccionada = '';
      this.pagoTocado = false;

      this.direccionEditable = esInvitado;

      this.formCheckout.get('domicilioEntrega')?.setValidators(Validators.required);
    } else {
      this.facturacionEnvio = false;
      this.showOpcionesPago = false;
      this.showAlertaPago = true;
      this.direccionEditable = false;

      // Para retiro en sucursal, el domicilio NO es obligatorio
      this.formCheckout.get('domicilioEntrega')?.clearValidators();
      this.formCheckout.get('domicilioEntrega')?.setValue('');
    }

    // Actualizamos estado
    ['user', 'mail', 'telefono', 'domicilioEntrega'].forEach(campo => {
      this.formCheckout.get(campo)?.updateValueAndValidity();
    });
  }


  //FUNCION PARA REALIZAR EL REGISTRO DEL PEDIDO
  async registroCheckout() {
    // 🔒 Evita doble click / doble envío (generaba pedidos duplicados)
    if (this.procesando || this.actualizandoPrecios) return;

    this.envioTocado = true;
    this.pagoTocado = true;
    this.mostrarErrores = true;

    if (this.direccionEditable) {
      const control = this.formCheckout.get('domicilioEntrega');
      control?.markAsTouched();
      control?.markAsDirty();
    }

    const formularioValido = this.formCheckout.valid;
    const envioSeleccionado = !!this.radioButtonSeleccionado;
    const pagoSeleccionado = !this.showOpcionesPago || !!this.opcionPagoSeleccionada;
    // Antes no se validaba: se podía confirmar "Retiro en sucursal" sin elegir sucursal
    const sucursalOk = this.radioButtonSeleccionado !== 'local'
      || (!!this.sucursalSeleccionada && this.sucursales.some(s => s.id === this.sucursalSeleccionada));

    if (!formularioValido || !envioSeleccionado || !pagoSeleccionado || !sucursalOk) {
      return;
    }

    const cliente = this.clienteEncontrado;

    if (!cliente) {
      await Swal.fire('Error', 'No se pudo identificar al cliente. Recargá la página e intentá nuevamente.', 'error');
      return;
    }

    if (!cliente.carrito || cliente.carrito.length === 0) {
      await Swal.fire('Carrito vacío', 'No hay productos en el carrito.', 'warning');
      return;
    }

    // Sin la cotización del dólar no se puede calcular el total en pesos
    try {
      await this.asegurarCotizacion(cliente);
    } catch (err: any) {
      await Swal.fire('No se pudo confirmar', err?.message || 'No pudimos obtener la cotización del dólar.', 'warning');
      return;
    }

    // Monto mínimo mayorista (antes solo se controlaba en el carrito lateral)
    if (cliente.esMayorista) {
      const minimo = cliente.mayoristaActivado ? this.montoMinimoFuturasCompras : this.montoParaActivar;
      const subtotal = this.getTotalPrecio(cliente);
      if (subtotal < minimo) {
        await Swal.fire(
          'Monto mínimo no alcanzado',
          `El monto mínimo de compra mayorista es ${this.formatearMoneda(minimo)}.`,
          'warning'
        );
        return;
      }
    }

    this.procesando = true;

    // Analytics: se arma antes de crear el pedido (después el carrito queda vacío)
    const itemsCompra = this.itemsAnalytics(cliente.carrito);
    const totalCompra = this.getTotalPrecio(cliente, this.usarPuntos, this.valorMonetarioPorPunto, this.cuponAplicado);
    const cuponCompra = this.cuponAplicado?.codigo || null;
    const envioCompra = this.radioButtonSeleccionado === 'domicilio' ? 'Envío' : 'Retiro en sucursal';

    try {
      const { nroPedido } = await this.createPedido();

      this.nroPedidoConfirmado = nroPedido;
      this.abrirModal();
      this.analytics.compra({ nroPedido, valor: totalCompra, items: itemsCompra, cupon: cuponCompra, envio: envioCompra });

    } catch (error: any) {

      console.error('❌ No se pudo completar el pedido:', error);

      if (error instanceof PreciosCambiadosError) {
        // Nada se guardó: actualizamos el carrito y el cliente revisa el nuevo total
        await this.aplicarPreciosNuevos(cliente, error.cambios);
      } else if (error instanceof CheckoutError) {
        await Swal.fire('No se pudo completar el pedido', error.message, 'warning');
      } else {
        await Swal.fire(
          'No se pudo completar el pedido',
          'Ocurrió un error y el pedido NO fue registrado. Verificá tu conexión e intentá nuevamente.',
          'error'
        );
      }

    } finally {
      this.procesando = false;
    }
  }


  /**
   * Registra el pedido de forma ATÓMICA (una sola transacción de Firestore):
   *  1. Toma el próximo número de pedido del contador
   *  2. Valida y descuenta stock de todos los productos
   *  3. Valida y consume el cupón
   *  4. Crea el pedido
   *  5. Vacía el carrito del cliente, actualiza puntos e historial
   *
   * Si cualquier paso falla, NO se guarda nada. Si devuelve OK, todo quedó guardado.
   */
  async createPedido(): Promise<{ nroPedido: number; pedidoId: string }> {

    const cliente = this.clienteEncontrado;
    const esInvitado = cliente.id === 'invitado';
    const esMayorista = !!cliente.esMayorista;

    // Copia "plana" del carrito (sin undefined, sin referencias compartidas)
    const carritoCliente: any[] = this.limpiarParaFirestore(cliente.carrito);

    const total = this.getTotalPrecio(
      cliente,
      this.usarPuntos,
      this.valorMonetarioPorPunto,
      this.cuponAplicado
    );

    // Descuento (cupón + puntos, solo sobre productos): se guarda para recalcular bien si se edita el pedido
    const descuentoCompra = Math.max(0, Math.round((
      subtotalesCarrito(cliente.carrito || [], item => this.getPrecioProducto(item)).productos -
      this.calcularTotales(cliente, this.usarPuntos, this.valorMonetarioPorPunto, this.cuponAplicado).productos) * 100) / 100);

    const puntosGastados = this.getPuntosAUsar();
    const puntosGanados = this.getPuntosASumar();

    let direccion = 'S/E';
    let pago = 'S/P';

    const envio =
      this.radioButtonSeleccionado === 'domicilio'
        ? 'Envío'
        : 'Retiro en sucursal';

    if (this.radioButtonSeleccionado === 'domicilio') {
      direccion = this.formCheckout.get('domicilioEntrega')?.value;
      pago =
        this.opcionPagoSeleccionada === 'efectivo'
          ? 'Efectivo'
          : 'Transferencia';
    }

    const sucursalADescontar =
      this.radioButtonSeleccionado === 'local' && this.sucursalSeleccionada
        ? this.sucursalSeleccionada
        : SUCURSAL_CENTRAL_ID;

    // =====================================================
    // PREPARACIÓN (fuera de la transacción)
    // =====================================================

    // Referencia al documento del contador
    const contadorSnap = await getDocs(collection(this.firestore, 'Contador Pedidos'));
    const contadorRef = contadorSnap.empty
      ? doc(collection(this.firestore, 'Contador Pedidos'))
      : contadorSnap.docs[0].ref;

    // ID real del documento de cada producto
    const idsPorItem: string[] = [];
    for (const item of carritoCliente) {
      if (esItemEquipo(item)) { idsPorItem.push(''); continue; }   // los equipos se leen aparte
      const id = await this.resolverDocIdProducto(item);
      if (!id) {
        throw new CheckoutError(`El producto "${item.nombre}" ya no está disponible. Quitalo del carrito para continuar.`);
      }
      idsPorItem.push(id);
    }
    const idsUnicos = [...new Set(idsPorItem.filter(Boolean))];
    // 📱 Equipos del carrito (unidades únicas)
    const equiposCarrito = carritoCliente.filter(esItemEquipo);

    const pedidoRef = doc(collection(this.firestore, 'Pedidos Pendientes'));
    const clienteRef = esInvitado ? null : doc(this.firestore, 'Clientes', cliente.id);
    const cuponRef = this.cuponAplicado?.id ? doc(this.firestore, 'Cupones', this.cuponAplicado.id) : null;

    // =====================================================
    // TRANSACCIÓN
    // =====================================================

    return await runTransaction(this.firestore, async (tx) => {

      // ---------- 1) LECTURAS (Firestore exige leer todo antes de escribir) ----------

      const contadorDoc = await tx.get(contadorRef);

      const productos = new Map<string, { ref: any; data: any; campos: Set<string> }>();
      for (const id of idsUnicos) {
        const ref = doc(this.firestore, 'productos', id);
        const snap = await tx.get(ref);
        if (!snap.exists()) {
          const item = carritoCliente[idsPorItem.indexOf(id)];
          throw new CheckoutError(`El producto "${item?.nombre}" ya no está disponible. Quitalo del carrito para continuar.`);
        }
        const data: any = snap.data();
        data.stockSucursales = mapToArray(data.stockSucursales);
        productos.set(id, { ref, data, campos: new Set<string>() });
      }

      const clienteDoc = clienteRef ? await tx.get(clienteRef) : null;
      const cuponDoc = cuponRef ? await tx.get(cuponRef) : null;

      // Equipos: cada uno tiene que seguir disponible (otro cliente o el local pudo llevárselo)
      const lecturasEquipos: { item: any; ref: any; data: any; imeiRef: any; imeiData: any }[] = [];
      for (const item of equiposCarrito) {
        const ref = doc(this.firestore, 'Equipos', item.equipoId);
        const snap = await tx.get(ref);
        const data: any = snap.exists() ? snap.data() : null;
        const imeiRef = data?.imei ? doc(this.firestore, 'EquiposIMEI', String(data.imei)) : null;
        const imeiSnap = imeiRef ? await tx.get(imeiRef) : null;
        lecturasEquipos.push({ item, ref, data, imeiRef, imeiData: imeiSnap?.exists() ? imeiSnap.data() : null });
      }
      const equiposVendidos = lecturasEquipos.filter(l => !l.data || l.data.estado !== 'disponible');
      if (equiposVendidos.length) {
        throw new CheckoutError(`Ya no está disponible: ${equiposVendidos.map(l => l.item.nombre).join(', ')}. ` +
          'Quitalo del carrito para continuar.');
      }

      // ---------- 2) VALIDACIONES ----------

      // Cupón: puede haberse agotado/desactivado desde que se aplicó
      let cuponUpdate: any = null;
      if (cuponRef) {
        const cupon: any = cuponDoc?.exists() ? cuponDoc.data() : null;
        const disponible = cupon ? (cupon.cantidadDisponible ?? 1) : 0;
        if (!cupon || cupon.activo === false || disponible <= 0) {
          throw new CheckoutError('El cupón aplicado ya no está disponible. Quitalo e intentá nuevamente.');
        }
        const nuevaCantidad = disponible - 1;
        cuponUpdate = { cantidadDisponible: nuevaCantidad };
        if (nuevaCantidad <= 0) cuponUpdate.activo = false;
      }

      // Precios: tienen que coincidir con los vigentes (si cambiaron, no se guarda nada)
      const cambiosPrecio: CambioPrecio[] = [];
      carritoCliente.forEach((item, i) => {
        if (esItemEquipo(item)) {
          const eq = lecturasEquipos.find(l => l.item.equipoId === item.equipoId)!.data;
          const nuevoEq: PrecioVigente = { precioFinal: precioListaEquipo(eq, esMayorista), precioOferta: null, oferta: false, moneda: eq.moneda || 'USD' };
          if (precioDistinto(item, nuevoEq)) cambiosPrecio.push({ index: i, nombre: item.nombre, nuevo: nuevoEq });
          return;
        }
        const nuevo = calcularPrecioVigente(productos.get(idsPorItem[i])!.data, item, esMayorista);
        if (nuevo && precioDistinto(item, nuevo)) {
          cambiosPrecio.push({ index: i, nombre: item.nombre, nuevo });
        }
      });
      if (cambiosPrecio.length) {
        throw new PreciosCambiadosError(cambiosPrecio);
      }

      // Stock: se descuenta sobre los datos leídos (acumulando si dos ítems son del mismo documento)
      const sinStock: string[] = [];
      const carritoFinal = carritoCliente.map((item, i) => {
        // Equipo: no tiene stock que descontar (se marca vendido); guardamos la cotización usada
        if (esItemEquipo(item)) {
          return { ...item, cantidad: 1, stockDescontado: null, cotizacionDolar: item.moneda === 'USD' ? (this.dolarJC || this.dolar) : null };
        }
        const prod = productos.get(idsPorItem[i])!;
        const resultado = this.descontarStockItem(prod, item, esMayorista, sucursalADescontar);
        if ('disponible' in resultado) {
          sinStock.push(`${item.nombre} (disponible: ${resultado.disponible})`);
          return item;
        }
        return {
          ...item,
          stockDescontado: resultado.stockDescontado,
          ...(item.moneda === 'USD' ? { cotizacionDolar: this.dolar } : {})
        };
      });

      if (sinStock.length) {
        throw new CheckoutError(
          `No hay stock suficiente de: ${sinStock.join(', ')}. Ajustá las cantidades en el carrito.`
        );
      }

      // ---------- 3) ESCRITURAS ----------

      // Número de pedido: siempre el valor ACTUAL del contador + 1
      const nroPedido = (Number(contadorDoc.exists() ? contadorDoc.data()?.['contador'] : 0) || 0) + 1;
      if (contadorDoc.exists()) {
        tx.update(contadorRef, { contador: nroPedido });
      } else {
        tx.set(contadorRef, { contador: nroPedido });
      }

      // Stock de productos (un update por documento)
      for (const { ref, data, campos } of productos.values()) {
        if (!campos.size) continue;
        const update: any = {};
        campos.forEach(c => update[c] = data[c] ?? 0);
        tx.update(ref, update);
      }

      // Pedido
      const unPedido: Pedido = this.limpiarParaFirestore({
        id: pedidoRef.id,
        nroPedido,
        fecha: this.generalService.formatearFechaDesdeDate(new Date()),
        user: this.formCheckout.get('user')?.value ?? '',
        mail: this.formCheckout.get('mail')?.value ?? '',
        telefono: this.formCheckout.get('telefono')?.value ?? '',
        domicilioEntrega: direccion ?? '',
        carrito: carritoFinal,
        entrega: envio,
        pago: pago,
        total: total,
        // Para que en Pedidos se vea y se recalcule siempre en pesos
        cotizacionDolar: this.dolar || null,
        cotizacionDolarJC: this.dolarJC || this.dolar || null,
        descuento: descuentoCompra,
        estado: 'pendiente',
        nombreCliente: this.formCheckout.get('user')?.value ?? '',
        apellidoCliente: '',
        sucursalRetiro: this.radioButtonSeleccionado === 'local' ? this.sucursalSeleccionada : null,
        clienteId: cliente.id,
        cupon: this.cuponAplicado ? { id: this.cuponAplicado.id, codigo: this.cuponAplicado.codigo ?? null } : null,
        puntosUsados: puntosGastados,
        puntosGanados: puntosGanados
      });
      tx.set(pedidoRef, unPedido);

      // 📱 Equipos: quedan vendidos (reservados por el pedido web). Si se cancela el pedido, vuelven a la venta.
      for (const l of lecturasEquipos) {
        tx.update(l.ref, {
          estado: 'vendido',
          venta: {
            ventaId: null,
            pedidoId: pedidoRef.id,
            nroPedido,
            fecha: new Date().toISOString(),
            origen: 'web',
            cliente: { id: cliente.id, nombre: unPedido.nombreCliente || unPedido.user || '' },
            tipoPrecio: esMayorista ? 'mayorista' : 'minorista',
            precio: l.item.precioFinal,
            moneda: l.item.moneda
          }
        });
        if (l.imeiRef && l.imeiData?.equipoId === l.item.equipoId) tx.delete(l.imeiRef);
      }

      // Cliente logueado: historial, carrito vacío, puntos, activación mayorista
      if (clienteRef && clienteDoc?.exists()) {
        const datosCliente: any = clienteDoc.data();

        const historico = this.limpiarParaFirestore({
          fecha: unPedido.fecha,
          nroPedido,
          carrito: carritoFinal,
          entrega: unPedido.entrega,
          pago: unPedido.pago,
          total: unPedido.total,
          id: pedidoRef.id,
        });

        const updateCliente: any = {
          carrito: [],
          historial: [...(datosCliente.historial || []), historico]
        };

        // Puntos: solo clientes minoristas
        if (!esMayorista) {
          const puntosActuales = Number(datosCliente.puntos) || 0;
          updateCliente.puntos = Math.max(0, puntosActuales - puntosGastados + puntosGanados);
        }

        if (datosCliente.esMayorista && !datosCliente.mayoristaActivado) {
          updateCliente.mayoristaActivado = total >= this.montoParaActivar;
        }

        tx.update(clienteRef, updateCliente);
      }

      if (cuponRef && cuponUpdate) {
        tx.update(cuponRef, cuponUpdate);
      }

      return { nroPedido, pedidoId: pedidoRef.id };

    }).then(resultado => {

      // ✅ Solo si la transacción se confirmó: actualizamos el estado local
      if (esInvitado) {
        localStorage.removeItem('carritoInvitado');
        cliente.carrito = [];
      } else {
        cliente.carrito = [];
        if (!esMayorista) {
          cliente.puntos = Math.max(0, (Number(cliente.puntos) || 0) - puntosGastados + puntosGanados);
        }
        this.generalService.setCliente(cliente);
      }

      return resultado;
    });
  }


  /** Resuelve el ID del documento de Firestore de un ítem del carrito */
  private async resolverDocIdProducto(item: any): Promise<string | null> {
    let productDocId: string = item.id || item.productoPadre;
    if (!productDocId) return null;

    if (productDocId.includes('-')) {
      const first = productDocId.split('-')[0];
      const testSnap = await getDoc(doc(this.firestore, 'productos', first));
      if (testSnap.exists()) {
        productDocId = first;
      }
    }
    return productDocId;
  }


  /**
   * Descuenta el stock de un ítem sobre los datos del producto en memoria.
   * No escribe nada: marca qué campos cambiaron para que la transacción los guarde.
   */
  private descontarStockItem(
    prod: { data: any; campos: Set<string> },
    item: any,
    esMayorista: boolean,
    sucursalPrioridadId: string
  ): { ok: true; stockDescontado: StockDescontado } | { ok: false; disponible: number } {

    const productoData = prod.data;
    const cantidad = Number(item.cantidad) || 0;

    if (cantidad <= 0) {
      return { ok: false, disponible: 0 };
    }

    // Variante embebida en el documento padre (estructura vieja)
    let varianteObj: any = null;
    if (Array.isArray(productoData.variantes) && item.codigoBarras) {
      varianteObj = productoData.variantes.find((v: any) => v.codigoBarras === item.codigoBarras) || null;
      if (varianteObj) {
        varianteObj.stockSucursales = mapToArray(varianteObj.stockSucursales);
      }
    }

    // ----- MAYORISTA -----
    if (esMayorista) {
      const usarVariante = varianteObj && varianteObj.stockMayorista != null;
      const origen = usarVariante ? varianteObj : productoData;
      const stockActual = Number(origen.stockMayorista) || 0;

      if (stockActual < cantidad) {
        return { ok: false, disponible: Math.max(0, stockActual) };
      }

      origen.stockMayorista = stockActual - cantidad;
      prod.campos.add(usarVariante ? 'variantes' : 'stockMayorista');

      return { ok: true, stockDescontado: { tipo: 'mayorista', cantidad } };
    }

    // ----- MINORISTA: se reparte entre sucursales, priorizando la elegida -----
    const sucursales: any[] = varianteObj ? varianteObj.stockSucursales : productoData.stockSucursales;
    const disponibleTotal = sucursales.reduce((acc, s) => acc + Math.max(0, Number(s.cantidad) || 0), 0);

    if (disponibleTotal < cantidad) {
      return { ok: false, disponible: disponibleTotal };
    }

    const ordenadas = [
      ...sucursales.filter(s => s.sucursalId === sucursalPrioridadId),
      ...sucursales.filter(s => s.sucursalId !== sucursalPrioridadId)
    ];

    let restante = cantidad;
    const detalle: { sucursalId: string; cantidad: number }[] = [];

    for (const s of ordenadas) {
      if (restante <= 0) break;
      const disponible = Number(s.cantidad) || 0;
      if (disponible <= 0) continue;
      const tomar = Math.min(disponible, restante);
      s.cantidad = disponible - tomar;
      detalle.push({ sucursalId: s.sucursalId, cantidad: tomar });
      restante -= tomar;
    }

    prod.campos.add(varianteObj ? 'variantes' : 'stockSucursales');

    return { ok: true, stockDescontado: { tipo: 'minorista', sucursales: detalle } };
  }


  /** Elimina undefined y referencias compartidas (Firestore rechaza undefined) */
  private limpiarParaFirestore<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj ?? null));
  }

  private formatearMoneda(valor: number): string {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(valor);
  }


  //FUNCION PARA HABILITAR Y DESHABILITAR EL CAMPO DIRECCION

  toggleDireccionEditable(event: any, direccionPorDefecto: string) {
    this.direccionEditable = event.target.checked;

    // El control se llama 'domicilioEntrega' ('direccion' no existe en el form)
    const control = this.formCheckout.get('domicilioEntrega');
    if (this.direccionEditable) {
      control?.setValue('');
    } else {
      control?.setValue(direccionPorDefecto);
    }
  }

  //FUNCION PARA ABRIR MODAL FIN DE PEDIDO
  abrirModal() {
    this.mostrarModal = true;
  }

  //FUNCION PARA CERRAR MODAL FIN DE PEDIDO
  cerrarModal() {
    this.mostrarModal = false;
    this.router.navigate(['inicio']);
    this.carritoService.actualizarCantidadProductos(this.clienteEncontrado);

    // 🟡 Por si es invitado, volvemos a limpiar el carrito
    if (this.clienteEncontrado.id === 'invitado') {
      localStorage.removeItem('carritoInvitado');
      this.carritoService.actualizarCantidadProductos(null);
    }
  }

  getPuntosAplicados(cliente: any): number {
    if (!cliente?.carrito) return 0;
    const total = cliente.carrito.reduce(
      (sum: number, prod: any) => sum + (prod.precioFinal * prod.cantidad),
      0
    );

    const maxPuntosPorMonto = Math.floor(total / this.valorMonetarioPorPunto);
    return Math.min(Number(cliente.puntos) || 0, maxPuntosPorMonto);
  }

  /**
   * Puntos que se descuentan al cliente. Solo si activó "Canjeá tus puntos".
   * (Antes se descontaban SIEMPRE, aunque el cliente no los usara.)
   * Misma lógica que getTotalPrecio: primero cupón, después puntos.
   */
  getPuntosAUsar(): number {
    const cliente = this.clienteEncontrado;
    // Los puntos son solo para clientes minoristas
    if (!cliente || cliente.id === 'invitado' || cliente.esMayorista || !this.usarPuntos) return 0;
    const puntos = Number(cliente.puntos) || 0;
    if (puntos <= 0) return 0;
    // Solo sobre los productos (los equipos no se pagan con puntos)
    const productosConCupon = this.calcularTotales(cliente, false, this.valorMonetarioPorPunto, this.cuponAplicado).productos;
    return Math.min(puntos, Math.floor(productosConCupon / this.valorMonetarioPorPunto));
  }

  /** Puntos que suma esta compra (sobre el total final a pagar) */
  getPuntosASumar(): number {
    const cliente = this.clienteEncontrado;
    if (!cliente || cliente.id === 'invitado' || cliente.esMayorista || !this.valorParaSumarPunto) return 0;
    // Los equipos no suman puntos
    const productosFinal = this.calcularTotales(cliente, this.usarPuntos, this.valorMonetarioPorPunto, this.cuponAplicado).productos;
    return Math.floor(productosFinal / this.valorParaSumarPunto);
  }

  aplicarCupon() {
    const codigo = this.cuponControl.value?.trim();
    if (!codigo) return;

    this.puntosService.obtenerCuponPorCodigo(codigo).then((cupon) => {
      if (cupon) {
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

  //FUNCION PARA COPIAR EL CVU AL PORTAPAPELES, podemos volarlo
  copiarCVU(cvu: string) {
    navigator.clipboard.writeText(cvu).then(() => {
      alert('CVU copiado al portapapeles');
    }).catch(() => {
      alert('No se pudo copiar el CVU');
    });
  }

  /** Total a pagar (el mismo que el resumen: con dólar, cupón y puntos) */
  getTotal(): number {
    if (!this.clienteEncontrado) return 0;
    return this.getTotalPrecio(this.clienteEncontrado, this.usarPuntos, this.valorMonetarioPorPunto, this.cuponAplicado);
  }
  generarQR(aliasOCvu: string): string {
    return `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(aliasOCvu)}&size=200x200`;
  }

  //FUNCION PARA OBTENER LOS DATOS DE LA EMPRESA
  getDatosEmpresa() {
    this.infoEmpresaService.obtenerInfoGeneral().subscribe(data => {
      this.infoEmpresa = data;
    });

  }

  /** Dólar JC (equipos): Gestiones → Empresa; si no está cargado, el dólar común */
  dolarJC = 0;

  /** Carrito → ítems de Analytics (precios en pesos) */
  private itemsAnalytics(carrito: any[]) {
    return (carrito || []).map(i => itemAnalytics(i, this.getPrecioProducto(i), i.cantidad));
  }

  /**
   * Si hay productos en dólares, la cotización tiene que estar cargada antes de confirmar.
   * Si todavía no llegó, se lee en el momento; si no hay forma de obtenerla, no se confirma.
   */
  private async asegurarCotizacion(cliente: any) {
    if (!(cliente?.carrito || []).some((i: any) => i?.moneda === 'USD')) return;
    if (this.cotizacionCargada && this.dolar > 0) return;
    try {
      const snap = await getDoc(doc(this.firestore, 'InfoEmpresa/general'));
      const info: any = snap.exists() ? snap.data() : null;
      if (Number(info?.dolar) > 0) {
        this.dolar = Number(info.dolar);
        this.dolarJC = cotizacionEquipos(info);
        this.cotizacionCargada = true;
      }
    } catch (err) {
      console.error('No se pudo leer la cotización del dólar:', err);
    }
    if (!(this.dolar > 0)) {
      throw new CheckoutError('No pudimos obtener la cotización del dólar. Recargá la página e intentá de nuevo.');
    }
  }

  getPrecioProducto(producto: any): number {
    let precio = producto.precioFinal || 0;
    if (producto.moneda === 'USD') {
      // Los equipos se pasan a pesos con el dólar JC
      precio = precio * (esItemEquipo(producto) ? (this.dolarJC || this.dolar) : this.dolar);
    }
    return precio;
  }


  /**
   * Total a pagar. Cupón y puntos se aplican solo a los productos:
   * los equipos van siempre a precio de lista (no tienen descuentos).
   */
  getTotalPrecio(
    cliente: any,
    usarPuntos: boolean = false,
    valorMonetarioPorPunto: number = 50,
    cuponAplicado: any = null
  ): number {
    return this.calcularTotales(cliente, usarPuntos, valorMonetarioPorPunto, cuponAplicado).total;
  }

  private calcularTotales(cliente: any, usarPuntos: boolean, valorMonetarioPorPunto: number, cuponAplicado: any) {
    return totalCarritoWeb(cliente?.carrito || [], item => this.getPrecioProducto(item), {
      cupon: cuponAplicado,
      usarPuntos,
      puntosCliente: Number(cliente?.puntos) || 0,
      valorPunto: valorMonetarioPorPunto
    });
  }

  /** ¿Hay equipos en el carrito? (para aclarar que no llevan cupón ni puntos) */
  get hayEquiposEnCarrito(): boolean {
    return (this.clienteEncontrado?.carrito || []).some((i: any) => esItemEquipo(i));
  }

  detalleEquipo(item: any): string {
    return detalleEquipo(item?.equipo);
  }

  buscarUndefined(obj: any, ruta = ''): void {

  if (obj === undefined) {
    console.error('❌ UNDEFINED EN:', ruta);
    return;
  }

  if (Array.isArray(obj)) {

    obj.forEach((item, index) => {
      this.buscarUndefined(
        item,
        `${ruta}[${index}]`
      );
    });

    return;
  }

  if (obj !== null && typeof obj === 'object') {

    Object.entries(obj).forEach(([key, value]) => {

      this.buscarUndefined(
        value,
        ruta ? `${ruta}.${key}` : key
      );

    });
  }
}

}
