import { Component } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { GeneralService } from 'src/app/shared/services/general.service';

@Component({
  selector: 'app-detalle-producto',
  templateUrl: './detalle-producto.component.html',
  styleUrls: ['./detalle-producto.component.css']
})
export class DetalleProductoComponent {

  detalleProducto: any[] = [];
  cantidad = 1
  idProducto!: string;

  constructor(private generalService:GeneralService, private route:ActivatedRoute){}

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
  cargaCarrito(id: any) {
    // let hayUsuario: any = localStorage.getItem('mail')
    // if (hayUsuario == null) {
    //   this.sharedService.setMostrarIngreso(true);
    // } else {
      this.generalService.cargarProductoCarrito(id,this.cantidad)
    // }

  }
}
