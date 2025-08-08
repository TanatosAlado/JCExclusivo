import { Component } from '@angular/core';
import {trigger, transition, style, animate} from '@angular/animations';
import { CarritoService } from '../../services/carrito.service';
import { LoginComponent } from 'src/app/modules/auth/views/login/login.component';
import { MatDialog } from '@angular/material/dialog';
import { Cliente } from 'src/app/modules/auth/models/cliente.model';
import { Router } from '@angular/router';
import { GeneralService } from '../../services/general.service';
import { ClientesService } from '../../services/clientes.service';
import { AuthService } from 'src/app/modules/auth/services/auth.service';
import { Observable } from 'rxjs';
import { DetalleOrdenComponent } from 'src/app/modules/admin/views/taller/components/detalle-orden/detalle-orden.component';

@Component({
  selector: 'app-navbar',
  templateUrl: './navbar.component.html',
  styleUrls: ['./navbar.component.css'],
  animations: [
    trigger('navbarFadeSlide', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateY(-20px)' }),
        animate('500ms ease-out', style({ opacity: 1, transform: 'translateY(0)' })),
      ]),
    ]),
  ],
})

export class NavbarComponent {

   usuarioLogueado: boolean = false;
  usrAdmin: boolean = false;
  searchTerm: string = '';
  resultados: any[] = [];
  productos:any[]=[]
  cantidadProductos: number = 0;
  cantidadProductos$ = this.carritoService.cantidadProductos$;
  clienteActual$: Observable<Cliente | null>;

  
  constructor(private carritoService: CarritoService,  
             private dialog:MatDialog,
              private router: Router,
             private generalService:GeneralService,
             private clientesService:ClientesService,
             private authService: AuthService) {

              this.clienteActual$ = this.generalService.getCliente();
  }

  ngOnInit(): void {
    const clienteRaw = localStorage.getItem('clienteActual');
    const cliente = clienteRaw ? JSON.parse(clienteRaw) : null;
    if (cliente && cliente.id !== 'invitado') {
      this.clientesService.getClienteById(cliente.id).subscribe({
        next: (clienteDb) => {
          this.generalService.setCliente(clienteDb);
          this.usrAdmin = clienteDb.administrador;
          this.carritoService.actualizarCantidadProductos(clienteDb);
        },
        error: () => {
          console.warn('Cliente no válido en localStorage');
          localStorage.removeItem('clienteActual');
        }
      });
    } else if (cliente) {
      // Si es invitado, lo dejo como está
      this.generalService.setCliente(cliente);
      this.carritoService.actualizarCantidadProductos(cliente);
    }
  }


  // Métodos para abrir los modales
  openIngreso(intencionMayorista: boolean = false) {
    const dialogRef = this.dialog.open(LoginComponent, {
      data: { esMayorista: intencionMayorista },
      width: '400px',
      disableClose: true,
      backdropClass: 'custom-backdrop',
      panelClass: 'custom-dialog'
    });

    dialogRef.afterClosed().subscribe((cliente: Cliente) => {
      if (cliente) {
        this.generalService.setCliente(cliente);
        this.usrAdmin = cliente.administrador;
        this.carritoService.actualizarCantidadProductos(cliente);
      } else {
        console.log('Modal cerrado sin login');
      }
    });
  }

  getCantidadProductos(carrito: any[]): number {
    return carrito.reduce((total, producto) => total + producto.cantidad, 0);
  }

  openRegistro() {
    // this.authService.openRegistroModal();
  }

  closeSesion() {
    this.generalService.setCliente(null);
    this.authService.logout(); // en caso de que uses firebase auth
    localStorage.removeItem('cliente');
    localStorage.removeItem('carritoInvitado');
    this.usrAdmin = false;
    this.carritoService.actualizarCantidadProductos(null);

    this.router.navigate(['/']);
  }

    //FUNCION PARA BUSCAR PRODUCTOS EN EL CUADRO DE BUSQUEDA Y APAREZCAN LA LISTA DE LOS ENCONTRADOS
    autocompletar() {
      // if (this.searchTerm.length === 0) {
      //   this.resultados = [];
      //   return;
      // }
      // this.resultados = this.productos.filter(item =>
      //   item.nombre.toLowerCase().includes(this.searchTerm.toLowerCase())
      // );
      // console.log(this.resultados)
    }

      //FUNCION PARA SELECCIONAR EL PRODUCTO ENCONTRADO Y VER SUS DETALLES
  seleccionar(item: any) {
    // this.searchTerm = item.nombre;
    // // this.sharedService.showProductoById(item.id)
    // this.resultados = []; // Ocultar la lista después de seleccionar
  }
    //FUNCION PARA NAVEGAR A LA BUSQUEDA DEL PEDIDO
    busquedaPedido(busqueda:any){
      // this.generalService.showBusqueda(busqueda)
      // this.searchTerm=''
      // this.resultados=[]
    }

     //FUNCION PARA GUARDAR LOS PRODUCTOS EN UN ARRAY
   getProductos(){
    // this.productoService.obtenerProductos().subscribe((productos) => {
    //   this.productos = productos;
    // })
    
  }

  abrirCarrito() {
    console.log('Carrito abierto');
  }

  cerrarMenu() {
    const closeButton = document.querySelector('#offcanvasMenu .btn-close') as HTMLElement;
    closeButton?.click();
  }

  async abrirHistorial() {
  // const historial = await this.pedidosService.obtenerHistorialCompleto(this.clienteLogueado.historial);

  // this.dialog.open(HistorialPedidosModalComponent, {
  //   width: '600px',
  //   data: historial,
  // });
}

abrirModalReparacion() {
  const modalRef = this.dialog.open(DetalleOrdenComponent, {
    width: '800px', // similar a 'lg'
    maxWidth: '90vw', // para que sea responsive
    panelClass: 'modal-centrado' // clase CSS para centrar verticalmente
  });

  // Si tu componente recibe datos por @Input:
  // modalRef.componentInstance.idOrden = '123';
}

}
