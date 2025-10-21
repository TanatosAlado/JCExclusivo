import { Component } from '@angular/core';
import { Cliente } from 'src/app/modules/auth/models/cliente.model';
import { GeneralService } from '../../services/general.service';
import { CarritoService } from '../../services/carrito.service';
import { ClientesService } from '../../services/clientes.service';
import { Router } from '@angular/router';
import { VouchersPuntosService } from '../../services/vouchers-puntos.service';
declare var bootstrap: any;

@Component({
  selector: 'app-carrito',
  templateUrl: './carrito.component.html',
  styleUrls: ['./carrito.component.css']
})
export class CarritoComponent {

  cliente: Cliente;
  carrito: any[] = []; // ✅ siempre vamos a trabajar con este array
  userLogueado = localStorage.getItem('mail');
  valorParaSumarPunto: number = 200;
  montoMinimoMayorista: number = 50000;

  constructor(
    public generalService: GeneralService,
    private carritoService: CarritoService,
    private clienteService: ClientesService,
    private router: Router,
    private puntosService: VouchersPuntosService
  ) { }

  async ngOnInit() {
    this.getCliente();
    await this.cargarConfiguracionYCalculos();
  }

  async cargarConfiguracionYCalculos() {
    const config = await this.puntosService.obtenerValoresPuntos();
    const montoMayorista = await this.puntosService.obtenerMontosMayoristas();

    if (config && config.valorParaSumarPunto) {
      this.valorParaSumarPunto = config.valorParaSumarPunto;
    } else {
      console.warn('⚠️ No se encontró configuración de puntos en Firestore. Usando valor por defecto.');
    }

    if (montoMayorista) {
      if (this.cliente && this.cliente.esMayorista) {
        if (this.cliente.mayoristaActivado) {
          this.montoMinimoMayorista = montoMayorista.minimoFuturasCompras;
        } else {
          this.montoMinimoMayorista = montoMayorista.minimoPrimeraCompra;
        }
      }
    } else {
      console.warn('⚠️ No se encontró configuración de monto mínimo mayorista en Firestore. Usando valor por defecto.');
    }
  }

  getCliente() {
    this.generalService.getCliente().subscribe(cliente => {
      this.cliente = cliente;

      if (this.cliente && this.cliente.id === 'invitado') {
        // Invitado → carrito desde localStorage
        const carritoLS = localStorage.getItem('carritoInvitado');
        this.carrito = carritoLS ? JSON.parse(carritoLS) : [];
        this.cliente.carrito = this.carrito; // mantener en sync
      } else {
        // Cliente logueado
        this.carrito = this.cliente?.carrito || [];
      }
    });
  }

  //FUNCION PARA DISMINUIR EN UNO LA CANTIDAD DEL PRODUCTO EN EL CARRO
  disminuirCantidad(producto: any): void {
    if (producto.cantidad > 1) {
      producto.cantidad--;
    }
    this.guardarCambiosCarrito();
    this.carritoService.actualizarCantidadProductos(this.cliente);
  }

  //FUNCION PARA AUMENTAR EN UNO LA CANTIDAD DEL PRODUCTO EN EL CARRO
  aumentarCantidad(producto: any): void {
    producto.cantidad++;
    this.guardarCambiosCarrito();
    this.carritoService.actualizarCantidadProductos(this.cliente);
  }

  //ACTUALIZAR CAMBIOS EN EL CARRITO DEL CLIENTE
  guardarCambiosCarrito() {
    if (!this.cliente) return;

    if (this.cliente.id === 'invitado') {
      localStorage.setItem('carritoInvitado', JSON.stringify(this.carrito));
      this.carritoService.actualizarCantidadProductosDesdeLocalStorage();
    } else {
      this.cliente.carrito = this.carrito;
      this.clienteService.actualizarCliente(this.cliente.id, this.cliente)
        .catch(err => console.error(err));
    }
  }

  eliminarDelCarrito(productoId: string) {
    this.carrito = this.carrito.filter(p => p.id !== productoId);
    this.cliente.carrito = this.carrito; // sincronizar

    if (this.cliente.id !== 'invitado') {
      this.carritoService.deleteProductoCarrito(this.cliente.id, productoId);
    }

    this.guardarCambiosCarrito();
    this.carritoService.actualizarCantidadProductos(this.cliente);
  }

  navigateCheckout() {
    const offcanvasElement = document.getElementById('offcanvasCarrito');

    if (offcanvasElement) {
      const offcanvasInstance = bootstrap.Offcanvas.getInstance(offcanvasElement);
      if (offcanvasInstance) {
        // Escuchar el evento oficial que avisa cuando terminó de cerrarse
        offcanvasElement.addEventListener(
          'hidden.bs.offcanvas',
          () => {
            // 🔹 Limpieza final del body
            document.body.style.removeProperty('overflow');
            document.body.style.removeProperty('padding-right');
            document.body.style.removeProperty('margin-right');

            // 🔹 Quitar backdrop si quedara
            document.querySelectorAll('.offcanvas-backdrop').forEach(b => b.remove());
            document.body.classList.remove('offcanvas-backdrop', 'show');

            // 🔹 Ahora sí, navegar
            this.router.navigate(['checkout']);
          },
          { once: true } // para que se ejecute solo una vez
        );

        // Cerrar el offcanvas (esto dispara el evento anterior)
        offcanvasInstance.hide();
      } else {
        // Si no hay instancia, forzar limpieza
        document.body.style.removeProperty('overflow');
        document.body.style.removeProperty('padding-right');
        document.body.style.removeProperty('margin-right');
        this.router.navigate(['checkout']);
      }
    } else {
      // Si no hay elemento, ir directo
      document.body.style.removeProperty('overflow');
      document.body.style.removeProperty('padding-right');
      document.body.style.removeProperty('margin-right');
      this.router.navigate(['checkout']);
    }
  }


  cerrarCarrito() {
    const offcanvasElement = document.getElementById('offcanvasCarrito');
    if (offcanvasElement) {
      const offcanvasInstance = bootstrap.Offcanvas.getInstance(offcanvasElement);
      offcanvasInstance?.hide();
    }

    // 🔥 limpieza manual de backdrop
    document.querySelectorAll('.offcanvas-backdrop').forEach(b => b.remove());
    document.body.classList.remove('offcanvas-backdrop', 'show');
    document.body.style.overflow = 'auto';
  }

  getPuntosPorCompra(): number {
    const total = this.getTotalPrecio();
    return Math.floor(total / this.valorParaSumarPunto);
  }

  getTotalPrecio(): number {
    return this.carrito.reduce((acc, prod) => acc + (prod.precioFinal * prod.cantidad), 0);
  }
}
