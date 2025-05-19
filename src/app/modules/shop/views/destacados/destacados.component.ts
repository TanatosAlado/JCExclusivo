import { Component } from '@angular/core';
import { ProductosService } from '../../services/productos.service';
import { Producto } from '../../models/producto.model';

@Component({
  selector: 'app-destacados',
  templateUrl: './destacados.component.html',
  styleUrls: ['./destacados.component.css']
})
export class DestacadosComponent {

    public destacados: Producto[] = [];

  constructor(private productosService: ProductosService) {}


  ngOnInit(): void {
    this.productosService.obtenerProductos().subscribe((productos) => {
      this.destacados = productos.filter((producto) => producto.destacado);
    })
  }


}
