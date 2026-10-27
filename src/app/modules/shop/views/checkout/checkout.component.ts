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

/** Sucursal de la que se descuenta stock por defecto (envíos a domicilio) */
const SUCURSAL_CENTRAL_ID = 'GtVWr5IHmosOOB8l6u6j';

/** Error de negocio con mensaje apto para mostrar al cliente */
class CheckoutError extends Error {
  constructor(message: string) {
    super(message);
  }
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
  nroPedidoConfirmado: number | null = null; // número REAL del pedido guardado

  sucursales: any[] = []; // lista de sucursales disponibles
  sucursalSeleccionada: string = ''; // id de la sucursal seleccionada por el cliente

   dolar: number = 1;

  constructor(private infoEmpresaService: InfoEmpresaService, private firestore: Firestore, private fb: FormBuilder, private clienteService: ClientesService, public pedidoService: PedidosService, public generalService: GeneralService, private contadorService: ContadorService, private router: Router, private carritoService: CarritoService, private puntosService: VouchersPuntosService, private sucursalesService: SucursalesService) {

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
      }
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
      this.sucursales = sucs;
      // Aquí no necesitamos tocar forms de stock, solo lo dejamos para otros componentes
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
      }
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
    if (this.procesando) return;

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
    const sucursalOk = this.radioButtonSeleccionado !== 'local' || !!this.sucursalSeleccionada;

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

    try {
      const { nroPedido } = await this.createPedido();

      this.nroPedidoConfirmado = nroPedido;
      this.abrirModal();

    } catch (error: any) {

      console.error('❌ No se pudo completar el pedido:', error);

      if (error instanceof CheckoutError) {
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
      const id = await this.resolverDocIdProducto(item);
      if (!id) {
        throw new CheckoutError(`El producto "${item.nombre}" ya no está disponible. Quitalo del carrito para continuar.`);
      }
      idsPorItem.push(id);
    }
    const idsUnicos = [...new Set(idsPorItem)];

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

      // Stock: se descuenta sobre los datos leídos (acumulando si dos ítems son del mismo documento)
      const sinStock: string[] = [];
      const carritoFinal = carritoCliente.map((item, i) => {
        const prod = productos.get(idsPorItem[i])!;
        const resultado = this.descontarStockItem(prod, item, esMayorista, sucursalADescontar);
        if ('disponible' in resultado) {
          sinStock.push(`${item.nombre} (disponible: ${resultado.disponible})`);
          return item;
        }
        return { ...item, stockDescontado: resultado.stockDescontado };
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

        const puntosActuales = Number(datosCliente.puntos) || 0;
        const updateCliente: any = {
          carrito: [],
          historial: [...(datosCliente.historial || []), historico],
          puntos: Math.max(0, puntosActuales - puntosGastados + puntosGanados)
        };

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
        cliente.puntos = Math.max(0, (Number(cliente.puntos) || 0) - puntosGastados + puntosGanados);
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
    if (!cliente || cliente.id === 'invitado' || !this.usarPuntos) return 0;
    const puntos = Number(cliente.puntos) || 0;
    if (puntos <= 0) return 0;
    const totalConCupon = this.getTotalPrecio(cliente, false, this.valorMonetarioPorPunto, this.cuponAplicado);
    return Math.min(puntos, Math.floor(totalConCupon / this.valorMonetarioPorPunto));
  }

  /** Puntos que suma esta compra (sobre el total final a pagar) */
  getPuntosASumar(): number {
    const cliente = this.clienteEncontrado;
    if (!cliente || cliente.id === 'invitado' || !this.valorParaSumarPunto) return 0;
    const totalFinal = this.getTotalPrecio(cliente, this.usarPuntos, this.valorMonetarioPorPunto, this.cuponAplicado);
    return Math.floor(totalFinal / this.valorParaSumarPunto);
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

  getTotal(): number {
    return this.generalService.getTotalPrecio(this.clienteEncontrado);
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

  getPrecioProducto(producto: any): number {
    let precio = producto.precioFinal || 0;
    if (producto.moneda === 'USD') {
      precio = precio * this.dolar;
    }
    return precio;
  }


  getTotalPrecio(
    cliente: any,
    usarPuntos: boolean = false,
    valorMonetarioPorPunto: number = 50,
    cuponAplicado: any = null
  ): number {
    let total = (cliente.carrito || []).reduce((sum: number, prod: any) => {
      let precio = Number(prod.precioFinal) || 0;

      if (prod.moneda === 'USD') {
        precio *= this.dolar;
      }
      const cantidad = Number(prod.cantidad) || 0;
      return sum + (precio * cantidad);
    }, 0);

    // Aplicar cupón si está disponible
    if (cuponAplicado && cuponAplicado.activo) {
      if (cuponAplicado.tipo === 'porcentaje') {
        const descuento = (cuponAplicado.valor / 100) * total;
        total -= descuento;
      } else if (cuponAplicado.tipo === 'monto') {
        total -= cuponAplicado.valor;
      }
      total = Math.max(total, 0);
    }

    // Aplicar puntos si corresponde
    if (usarPuntos && cliente.puntos > 0) {
      const maxPuntosPorMonto = Math.floor(total / valorMonetarioPorPunto);
      const puntosUsables = Math.min(cliente.puntos, maxPuntosPorMonto);
      const descuento = puntosUsables * valorMonetarioPorPunto;
      total = Math.max(total - descuento, 0);
    }
    return total;
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
