import { Component } from '@angular/core';
import { ProductosService } from '../../services/productos.service';
import { Producto } from '../../models/producto.model';
import { AuthService } from 'src/app/modules/auth/services/auth.service';
import { combineLatest } from 'rxjs';

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


// ngOnInit(): void {
//   this.authService.getUsuarioActual().subscribe(cliente => {
//     this.esMayorista = cliente?.esMayorista ?? false;

//     this.productosService.obtenerProductosAgrupados().subscribe((productos) => {
//       this.destacados = productos.filter(p => {
//         if (!p.destacado) return false;

//         // Producto sin variantes (producto único)
//         if (!p.variantes || p.variantes.length === 0) {
//           return this.esMayorista
//             ? !!p.precioMayorista
//             : !!p.precioMinorista;
//         }

//         // Producto con variantes
//         return p.variantes.some(v =>
//           this.esMayorista
//             ? v.precioMayorista > 0
//             : v.precioMinorista > 0
//         );
//       });

//     });
//   });
// }

ngOnInit(): void {
  combineLatest([
    this.authService.getUsuarioActual(),
    this.productosService.obtenerProductosAgrupados()
  ]).subscribe(([cliente, productos]) => {

    this.esMayorista = cliente?.esMayorista ?? false;

    this.destacados = productos.filter(p => {


      if (!p.destacado) return false;

      if (!p.variantes || p.variantes.length === 0) {
        return this.esMayorista
          ? !!p.precioMayorista
          : !!p.precioMinorista;
      }

      return p.variantes.some(v =>
        this.esMayorista
          ? v.precioMayorista > 0
          : v.precioMinorista > 0
      );
    });

  });
}

// 👇 método para usar directamente en el HTML
getPrecioVisible(producto: Producto): number {
  return this.esMayorista ? producto.precioMayorista : producto.precioMinorista;
}



}
