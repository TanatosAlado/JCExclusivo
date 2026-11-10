import { Component, OnDestroy } from '@angular/core';
import {trigger, transition, style, animate} from '@angular/animations';
import { CarritoService } from '../../services/carrito.service';
import { LoginComponent } from 'src/app/modules/auth/views/login/login.component';
import { MatDialog } from '@angular/material/dialog';
import { Cliente } from 'src/app/modules/auth/models/cliente.model';
import { NavigationEnd, Router } from '@angular/router';
import { GeneralService } from '../../services/general.service';
import { ClientesService } from '../../services/clientes.service';
import { AuthService } from 'src/app/modules/auth/services/auth.service';
import { Observable, Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { permisosDe } from 'src/app/core/secciones';
import { AvisoMayoristaService } from '../../services/aviso-mayorista.service';
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

export class NavbarComponent implements OnDestroy {
  private navegacionSub?: Subscription;

   usuarioLogueado: boolean = false;
  usrAdmin: boolean = false;
  /** Tiene permiso para Despacho (el link solo se muestra si lo tiene) */
  usrDespacho: boolean = false;
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
             private authService: AuthService,
             private avisoMayorista: AvisoMayoristaService) {

              // Al cambiar de página se cierran los paneles laterales (menú mobile / carrito).
              // Bootstrap no se entera de la navegación de Angular y quedaban abiertos con el fondo gris.
              this.navegacionSub = this.router.events
                .pipe(filter(e => e instanceof NavigationEnd))
                .subscribe(() => this.cerrarPanelesLaterales());

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
          this.usrDespacho = permisosDe(clienteDb).includes('despacho');
          this.carritoService.actualizarCantidadProductos(clienteDb);
          this.sincronizarMayorista(clienteDb);
          this.avisoMayorista.mostrar(clienteDb);
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
        this.usrDespacho = permisosDe(cliente).includes('despacho');
        this.carritoService.actualizarCantidadProductos(cliente);
        this.avisoMayorista.mostrar(cliente);
      } else {
        //console.log('Modal cerrado sin login');
      }
    });
  }

  /**
   * Si un administrador aprobó (o cambió) la cuenta mayorista mientras tanto, la sesión guardada
   * se pone al día: así ve los precios que corresponden sin tener que volver a iniciar sesión.
   */
  private sincronizarMayorista(clienteDb: any) {
    const actual: any = this.authService.getClienteActualValor();
    if (!actual || actual.id !== clienteDb?.id) return;
    const cambio = actual.esMayorista !== clienteDb.esMayorista
      || JSON.stringify(actual.solicitudMayorista ?? null) !== JSON.stringify(clienteDb.solicitudMayorista ?? null);
    if (!cambio) return;
    this.authService.setUsuarioActual({
      ...actual,
      esMayorista: clienteDb.esMayorista === true,
      mayoristaActivado: clienteDb.mayoristaActivado === true,
      solicitudMayorista: clienteDb.solicitudMayorista,
      razonSocial: clienteDb.razonSocial ?? actual.razonSocial,
      cuit: clienteDb.cuit ?? actual.cuit
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
    this.usrDespacho = false;
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
    
  }

  ngOnDestroy(): void {
    this.navegacionSub?.unsubscribe();
  }

  /** Cierra el menú mobile (al tocar una opción) */
  cerrarMenu() {
    this.cerrarPanel('offcanvasMenu');
  }

  /** Cierra un panel lateral (offcanvas) de Bootstrap usando su propia API */
  private cerrarPanel(id: string) {
    const el = document.getElementById(id);
    if (!el || !el.classList.contains('show')) return;
    const bs = (window as any).bootstrap;
    const instancia = bs?.Offcanvas?.getInstance(el) || bs?.Offcanvas?.getOrCreateInstance?.(el);
    if (instancia) {
      instancia.hide();
    } else {
      el.classList.remove('show');
    }
    // Si por algún motivo quedó el fondo gris colgado, se limpia
    setTimeout(() => this.limpiarFondo(), 450);
  }

  private cerrarPanelesLaterales() {
    this.cerrarPanel('offcanvasMenu');
    this.cerrarPanel('offcanvasCarrito');
    setTimeout(() => this.limpiarFondo(), 450);
  }

  /** Saca el fondo gris y el bloqueo de scroll si no queda ningún panel abierto */
  private limpiarFondo() {
    if (document.querySelector('.offcanvas.show')) return;
    document.querySelectorAll('.offcanvas-backdrop').forEach(b => b.remove());
    document.body.style.removeProperty('overflow');
    document.body.style.removeProperty('padding-right');
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
