import { Component, Input } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { GeneralService } from 'src/app/shared/services/general.service';
import { Producto } from '../../models/producto.model';
import { LoginComponent } from 'src/app/modules/auth/views/login/login.component';
import { Cliente } from 'src/app/modules/auth/models/cliente.model';
import { ToastService } from 'src/app/shared/services/toast.service';
import { MatDialog } from '@angular/material/dialog';

@Component({
  selector: 'app-detalle-producto',
  templateUrl: './detalle-producto.component.html',
  styleUrls: ['./detalle-producto.component.css']
})
export class DetalleProductoComponent {

  detalleProducto: any[] = [];
  cantidad = 1
  idProducto!: string;
  loadingCarrito: { [id: string]: boolean } = {};
  @Input() esMayorista: boolean = false;

  constructor(private generalService:GeneralService, private route:ActivatedRoute, private toastService: ToastService, private dialog: MatDialog,){}

  ngOnInit(){
    // this.getProductoSeleccionado()
   this.route.params.subscribe(params => {
      const idProducto = params['id'];
      this.generalService.getProductoByNombre(idProducto).then(data => {
        this.detalleProducto = data;
        console.log("el detalle producto es",this.detalleProducto)
      });
    });
  }

  //FUNCION PARA GUARDAR EL PRODUCTO SELECCIONADO

  getProductoSeleccionado(){
     this.generalService.getProductoById(this.idProducto).then(data => {
        this.detalleProducto = data;
        console.log("producto seleccionado"+this.detalleProducto)
  })
  
}
  
  //FUNCION PARA RESTAR CANTIDAD PRODUCTOS DEL CARRO
  disminuirCantidad() {
    if (this.cantidad > 1) {
      this.cantidad--;
    }
  }
  aumentarCantidad() {
    this.cantidad++;
  }

    //FUNCION PARA CARGAR EL PRODCUTO EN EL CARRO DEL CLIENTE
  cargaCarrito(producto: Producto) {
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


}
