import { Component } from '@angular/core';
import { ProductosService } from '../../services/productos.service';
import { Producto } from '../../models/producto.model';
import { AuthService } from 'src/app/modules/auth/services/auth.service';

@Component({
  selector: 'app-destacados',
  templateUrl: './destacados.component.html',
  styleUrls: ['./destacados.component.css']
})
export class DestacadosComponent {

    public destacados: Producto[] = [];
    public esMayorista: boolean = false;

  constructor(
  private productosService: ProductosService,
  private authService: AuthService
) {}


ngOnInit(): void {
  this.authService.getUsuarioActual().subscribe(cliente => {
    this.esMayorista = cliente?.esMayorista ?? false;

    this.productosService.obtenerProductosAgrupados().subscribe((productos) => {
      this.destacados = productos.filter(p =>
        p.destacado &&
        (this.esMayorista ? p.precioMayorista : p.precioMinorista)
      );
    });
  });
}

// 👇 método para usar directamente en el HTML
getPrecioVisible(producto: Producto): number {
  return this.esMayorista ? producto.precioMayorista : producto.precioMinorista;
}



}
