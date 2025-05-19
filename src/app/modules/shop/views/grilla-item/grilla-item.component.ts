import { Component } from '@angular/core';
import { Producto } from '../../models/producto.model';
import { ProductosService } from '../../services/productos.service';

@Component({
  selector: 'app-grilla-item',
  templateUrl: './grilla-item.component.html',
  styleUrls: ['./grilla-item.component.css']
})
export class GrillaItemComponent {

  public productos: Producto[] = [];

  constructor(private productosService: ProductosService) {}

  ngOnInit(): void {
    this.productosService.obtenerProductos().subscribe((res) => {
      this.productos = res;
    });
  }

}
