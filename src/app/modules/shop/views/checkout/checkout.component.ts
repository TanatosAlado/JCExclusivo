import { Component } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, Validators } from '@angular/forms';
import { Cliente } from 'src/app/modules/auth/models/cliente.model';
import { Firestore, getDocs, query, where } from '@angular/fire/firestore';
import { ClientesService } from 'src/app/shared/services/clientes.service';
import { PedidosService } from 'src/app/shared/services/pedidos.service';
import { GeneralService } from 'src/app/shared/services/general.service';
import { Router } from '@angular/router';
import { CarritoService } from 'src/app/shared/services/carrito.service';
import { Contador } from '../../models/contador.model';
import { Pedido } from '../../models/pedido.model';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { ContadorService } from 'src/app/shared/services/contador.service';
import { VouchersPuntosService } from 'src/app/shared/services/vouchers-puntos.service';
import { collection } from 'firebase/firestore/lite';
import { InfoEmpresa } from 'src/app/shared/models/infoEmpresa.model';
import { InfoEmpresaService } from 'src/app/shared/services/info-empresa.service';

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

  constructor(private infoEmpresaService: InfoEmpresaService, private firestore: Firestore, private fb: FormBuilder, private clienteService: ClientesService, public pedidoService: PedidosService, public generalService: GeneralService, private contadorService: ContadorService, private router: Router, private carritoService: CarritoService, private puntosService: VouchersPuntosService) {

    this.formCheckout = this.fb.group({
      user: ['', [Validators.required]],
      mail: ['', Validators.required],
      telefono: ['', Validators.required],
      domicilioEntrega: ['', Validators.required],
    });
  }

  async ngOnInit() {
    this.getCliente()
    this.getContadorPedidos()
     this.getDatosEmpresa()
    await this.inicializarValoresPuntos();
    this.cuponControl.valueChanges.subscribe(() => {
      if (this.cuponInvalido) {
        this.cuponInvalido = false;
        this.mensajeCupon = '';
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
    } 

  }
  //FUNCION PARA BUSCAR EL CLIENTE LOGUEADO Y  GUARDARLO EN UNA VARIABLE
  getCliente() {
    this.generalService.getCliente().subscribe(cliente => {
      this.clienteEncontrado = cliente;
      if (cliente) {
        if (cliente.id === 'invitado') {
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
  getTotalPrecio(cliente: any): number {
    return cliente.carrito.reduce((total: number, prod: any) => total + (prod.precioFinal * prod.cantidad), 0);
  }

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
  registroCheckout(puntoRestar: number, puntosSumar: number) {
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

    if (formularioValido && envioSeleccionado && pagoSeleccionado) {
      console.log('Formulario válido, se procede a crear el pedido');
      this.createPedido(puntoRestar, puntosSumar);
      if (this.cuponAplicado) {
        this.puntosService.marcarCuponComoUsado(this.cuponAplicado.id);
      }
      this.sumarContador()
      this.contadorService.updateContador(this.contador[0].id, { contador: this.contador[0].contador });
      this.abrirModal()
    }
  }

  //FUNCION PARA CREAR EL PEDIDO
  createPedido(puntoRestar: number, puntosSumar: number) {
    const carritoCliente = this.clienteEncontrado.carrito;
    const total = this.generalService.getTotalPrecio(this.clienteEncontrado, this.usarPuntos, this.valorMonetarioPorPunto, this.cuponAplicado);
    let direccion = 'S/E';
    let pago = 'S/P';
    const envio = this.radioButtonSeleccionado === 'domicilio' ? 'Envío' : 'Retiro';

    if (this.radioButtonSeleccionado === 'domicilio') {
      direccion = this.formCheckout.get('domicilioEntrega')?.value;
      pago = this.opcionPagoSeleccionada === 'efectivo' ? 'Efectivo' : 'Transferencia';
    }

    const unPedido: Pedido = {
      id: '',
      nroPedido: this.contador[0]?.contador != null ? this.contador[0].contador + 1 : 1,
      fecha: this.generalService.formatearFechaDesdeDate(new Date()),
      user: this.formCheckout.get('user')?.value,
      mail: this.formCheckout.get('mail')?.value,
      telefono: this.formCheckout.get('telefono')?.value,
      domicilioEntrega: direccion,
      carrito: carritoCliente,
      entrega: envio,
      pago: pago,
      total: total,
      estado: 'pendiente',
      nombreCliente: this.formCheckout.get('user')?.value, // para invitados también
      apellidoCliente: '', // o lo separás del nombre si querés
    };

    this.pedidoService.createPedido(unPedido).then(async (docRef) => {
      this.updateIdPedido(docRef.id, unPedido);

      // 🟢 Si el cliente NO es invitado → actualizar historial y limpiar carrito en Firebase
      if (this.clienteEncontrado.id !== 'invitado') {
        const historico = {
          fecha: unPedido.fecha,
          nroPedido: unPedido.nroPedido,
          carrito: carritoCliente,
          entrega: unPedido.entrega,
          pago: unPedido.pago,
          total: unPedido.total,
          id: docRef.id,
        };
        this.clienteEncontrado.historial.push(historico);
        this.clienteEncontrado.carrito = [];
        const puntosGanados = Math.floor(puntosSumar);
        const puntosGastados = Math.floor(puntoRestar);
        this.clienteEncontrado.puntos = this.clienteEncontrado.puntos - puntosGastados + puntosGanados;
        if(this.clienteEncontrado.esMayorista && !this.clienteEncontrado.mayoristaActivado) {
          this.clienteEncontrado.mayoristaActivado = historico.total >= this.montoParaActivar;
        }

        await this.clienteService.actualizarCliente(this.clienteEncontrado.id, this.clienteEncontrado);
      } else {
        // 🟡 Si es invitado, limpiamos el localStorage del carrito
        localStorage.removeItem('carritoInvitado');
      }

      // 🔁 Siempre actualizamos stock de productos
      for (const item of carritoCliente) {
        const productoRef = doc(this.firestore, 'productos', item.id);
        try {
          const productoSnap = await getDoc(productoRef);
          if (productoSnap.exists()) {
            const productoData: any = productoSnap.data();
            const stockActual = productoData.stock ?? 0;
            const cantidadComprada = item.cantidad ?? 0;
            const stockNuevo = Math.max(stockActual - cantidadComprada, 0);
            await updateDoc(productoRef, { stock: stockNuevo });
          }
        } catch (error) {
          console.error('Error al actualizar stock:', error);
        }
      }

    }).catch((error) => {
      console.error('Error al crear pedido:', error);
    });
  }


  //FUNCION PARA ACTUALIZAR EL ID EN EL ARREGLO CLIENTES CON EL DE FIREBASE
  updateIdPedido(idOriginal: string, unPedido: Pedido) {
    let idUpdate: any = unPedido
    idUpdate.id = idOriginal
    this.pedidoService.updatePedido(idOriginal, idUpdate)
  }


  //FUNCION PARA HABILITAR Y DESHABILITAR EL CAMPO DIRECCION

  toggleDireccionEditable(event: any, direccionPorDefecto: string) {
    this.direccionEditable = event.target.checked;

    if (this.direccionEditable) {
      this.formCheckout.get('direccion')?.enable();
      this.formCheckout.get('direccion')?.setValue('');
    } else {
      this.formCheckout.get('direccion')?.disable();
      this.formCheckout.get('direccion')?.setValue(direccionPorDefecto);
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

  //FUNCION PARA SUMAR EL CONTADOR DE PEDIDOS FINALIZADOS
  sumarContador() {
    if (this.contador.length > 0) {
      this.contador[0].contador += 1;
    }
  }

  getPuntosAplicados(cliente: any): number {
    const total = cliente.carrito.reduce(
      (sum: number, prod: any) => sum + (prod.precioFinal * prod.cantidad),
      0
    );

    const maxPuntosPorMonto = Math.floor(total / this.valorMonetarioPorPunto);
    return Math.min(cliente.puntos, maxPuntosPorMonto);
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
}
