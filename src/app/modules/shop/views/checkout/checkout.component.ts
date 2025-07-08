import { Component } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Cliente } from 'src/app/modules/auth/models/cliente.model';
import { Firestore } from '@angular/fire/firestore';
import { ClientesService } from 'src/app/shared/services/clientes.service';
import { PedidosService } from 'src/app/shared/services/pedidos.service';
import { GeneralService } from 'src/app/shared/services/general.service';
import { Router } from '@angular/router';
import { CarritoService } from 'src/app/shared/services/carrito.service';
import { Contador } from '../../models/contador.model';
import { Pedido } from '../../models/pedido.model';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { ContadorService } from 'src/app/shared/services/contador.service';

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


  constructor(private firestore: Firestore, private fb: FormBuilder, private clienteService: ClientesService, public pedidoService: PedidosService, public generalService: GeneralService, private contadorService: ContadorService, private router: Router, private carritoService: CarritoService) {

    this.formCheckout = this.fb.group({
      user: ['', [Validators.required]],
      mail: ['', Validators.required],
      telefono: ['', Validators.required],
      domicilioEntrega: ['', Validators.required],
    });
  }

  ngOnInit() {
    this.getCliente()
    this.getContadorPedidos()

  }
  //FUNCION PARA BUSCAR EL CLIENTE LOGUEADO Y  GUARDARLO EN UNA VARIABLE
  getCliente() {
    this.generalService.getCliente().subscribe(cliente => {
      this.clienteEncontrado = cliente
    })
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
    const cliente = this.clienteEncontrado
    this.formCheckout.patchValue({
      user: cliente.usuario,
      mail: cliente.mail,
      telefono: cliente.telefono,
      domicilioEntrega: cliente.direccion
    });
    if (this.radioButtonSeleccionado == 'domicilio') {

      this.facturacionEnvio = true
      this.showOpcionesPago = true
      this.showAlertaPago = false
      this.pagoTocado = false
      this.showOpcionesPago = true;
      this.pagoTocado = false;
      this.opcionPagoSeleccionada = '';
      this.direccionEditable = false;
      this.envioTocado = false;
      const control = this.formCheckout.get('domicilioEntrega');
      control?.markAsPristine();
      control?.markAsUntouched();
    }
    else {
      this.facturacionEnvio = false
      this.showOpcionesPago = false
      this.showAlertaPago = true
      this.direccionEditable = false;
      const control = this.formCheckout.get('domicilioEntrega');
      // control?.reset();
      control?.markAsPristine();
      control?.markAsUntouched();

    }
  }

  //FUNCION PARA REALIZAR EL REGISTRO DEL PEDIDO
  registroCheckout() {
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
      this.createPedido()
      this.sumarContador()
      this.contadorService.updateContador(this.contador[0].id, { contador: this.contador[0].contador });
      this.abrirModal()
    }
  }

  //FUNCION PARA CREAR EL PEDIDO
  createPedido() {
    const carritoCliente = this.clienteEncontrado.carrito;
    const total = this.generalService.getTotalPrecio(this.clienteEncontrado);
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
      nombreCliente: this.clienteEncontrado.nombre,
      apellidoCliente: this.clienteEncontrado.apellido
    };

    this.pedidoService.createPedido(unPedido).then(async (docRef) => {
      this.updateIdPedido(docRef.id, unPedido);
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
      await this.clienteService.actualizarCliente(this.clienteEncontrado.id, this.clienteEncontrado);
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
          } else {
            
          }
        } catch (error) {  
        }
      }
    }).catch((error) => {
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
    this.carritoService.actualizarCantidadProductos(this.clienteEncontrado)
  }

  //FUNCION PARA SUMAR EL CONTADOR DE PEDIDOS FINALIZADOS
  sumarContador() {
    if (this.contador.length > 0) {
      this.contador[0].contador += 1;
    }
  }

}
