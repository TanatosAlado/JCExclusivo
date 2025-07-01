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

    this.productosService.obtenerProductos().subscribe((productos) => {
      this.destacados = productos.filter(p =>
        p.destacado &&
        (this.esMayorista ? p.ventaMayorista : p.ventaMinorista)
      );
    });
  });
  }


}
