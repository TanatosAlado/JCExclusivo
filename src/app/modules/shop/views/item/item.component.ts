import { Component, Input, ViewEncapsulation } from '@angular/core';
import { Producto } from '../../models/producto.model';

@Component({
  selector: 'app-item',
  templateUrl: './item.component.html',
  styleUrls: ['./item.component.css'],
    encapsulation: ViewEncapsulation.None
})
export class ItemComponent {

  @Input() producto!: Producto;

  calcularDescuento(producto: Producto): number {
  if (producto.oferta && producto.precioOferta < producto.precioMinorista) {
    const descuento = 100 - (producto.precioOferta * 100) / producto.precioMinorista;
    return Math.round(descuento);
  }
  return 0;
}

}
