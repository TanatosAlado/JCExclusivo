import { Component, Input, ViewEncapsulation } from '@angular/core';
import { Producto } from '../../models/producto.model';
import { GeneralService } from 'src/app/shared/services/general.service';
import { ToastService } from 'src/app/shared/services/toast.service';
import { MatDialog } from '@angular/material/dialog';
import { LoginComponent } from 'src/app/modules/auth/views/login/login.component';
import { Cliente } from 'src/app/modules/auth/models/cliente.model';
import { Router } from '@angular/router';

@Component({
  selector: 'app-item',
  templateUrl: './item.component.html',
  styleUrls: ['./item.component.css'],
  encapsulation: ViewEncapsulation.None
})
export class ItemComponent {

  @Input() producto!: Producto;
  @Input() esMayorista: boolean = false;
  loadingCarrito: { [id: string]: boolean } = {};

  constructor(
    private generalService: GeneralService,
    private toastService: ToastService,
    private dialog: MatDialog,
    private router: Router
  ) { }

  calcularDescuento(producto: Producto): number {
    const precioBase = this.esMayorista ? producto.precioMayorista : producto.precioMinorista;
    if (producto.oferta && producto.precioOferta < precioBase) {
      const descuento = 100 - (producto.precioOferta * 100) / precioBase;
      return Math.round(descuento);
    }
    return 0;
  }

  agregarCarrito(producto: Producto) {
    console.log('Agregando al carrito:', producto);
    const cliente = this.generalService.getClienteActual();
    this.loadingCarrito[producto.id] = true;

    const finalizar = () => this.loadingCarrito[producto.id] = false;

    if (!cliente) {
      const dialogRef = this.dialog.open(LoginComponent, {
        width: '400px',
        disableClose: true,
        backdropClass: 'custom-backdrop',
        panelClass: 'custom-dialog'
      });

      dialogRef.afterClosed().subscribe((clienteLogueado: Cliente) => {
        if (clienteLogueado) {
          this.generalService.setCliente(clienteLogueado);
          localStorage.setItem('cliente', JSON.stringify(clienteLogueado));
          this.procesarProductoEnCarrito(clienteLogueado, producto, finalizar);
        } else {
          this.toastService.toastMessage(
            'Debes iniciar sesión o continuar como invitado para agregar productos al carrito.',
            'orange',
            3000
          );
          finalizar();
        }
      });

      return;
    }

    this.procesarProductoEnCarrito(cliente, producto, finalizar);
  }

  private procesarProductoEnCarrito(cliente: Cliente, producto: Producto, finalizar: () => void) {
    this.generalService.cargarProductoCarrito(producto, 1)
      .then(() => {
        this.toastService.toastMessage('Producto agregado al carrito', 'green', 2000);
      })
      .catch(err => {
        this.toastService.toastMessage('El producto no pudo agregarse', 'red', 2000);
        console.error(err);
      })
      .finally(finalizar);
  }

  // Navegamos al detalle usando el id (mejor que descripcion porque es único)
  verDetalle(producto: Producto) {
    this.router.navigate([`producto/${producto.id}`]);
  }
}
