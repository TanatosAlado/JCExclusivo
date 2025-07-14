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

  constructor(private generalService:GeneralService,private toastService: ToastService,private dialog: MatDialog,private router: Router){

  }

  calcularDescuento(producto: Producto): number {
  if (producto.oferta && producto.precioOferta < producto.precioMinorista) {
    const descuento = 100 - (producto.precioOferta * 100) / producto.precioMinorista;
    return Math.round(descuento);
  }
  return 0;
}


agregarCarrito(producto: any) {
  const cliente = this.generalService.getClienteActual();
  this.loadingCarrito[producto.id] = true;

  const finalizar = () => this.loadingCarrito[producto.id] = false;

  // Si NO hay cliente logueado ni invitado → abrir login opcional
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
        localStorage.setItem('cliente', JSON.stringify(clienteLogueado)); // guardás todo el objeto para recuperar
        this.procesarProductoEnCarrito(clienteLogueado, producto, finalizar);
      } else {
        // Usuario cerró el modal sin loguear ni continuar como invitado
        this.toastService.toastMessage('Debes iniciar sesión o continuar como invitado para agregar productos al carrito.', 'orange', 3000);
        finalizar();
      }
    });

    return;
  }

  // Cliente ya logueado o invitado
  this.procesarProductoEnCarrito(cliente, producto, finalizar);
}

private procesarProductoEnCarrito(cliente: Cliente, producto: any, finalizar: () => void) {
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

//FUNCION PARA BUSCAR PRODUCTO POR NOMBRE Y NAVEGAR AL DETALLE
buscarPorNombre(nombre:string){
 this.router.navigate([`producto/${nombre}`])
 console.log(this.producto)

}


}
