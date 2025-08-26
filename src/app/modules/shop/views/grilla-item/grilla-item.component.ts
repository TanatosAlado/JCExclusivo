import { Component } from '@angular/core';
import { Producto } from '../../models/producto.model';
import { ProductosService } from '../../services/productos.service';
import { AuthService } from 'src/app/modules/auth/services/auth.service';

@Component({
  selector: 'app-grilla-item',
  templateUrl: './grilla-item.component.html',
  styleUrls: ['./grilla-item.component.css']
})
export class GrillaItemComponent {

  Math = Math;

  productosOriginal: Producto[] = [];
  productosFiltrados: Producto[] = [];

  filtroNombre: string = '';
  filtroRubro: string = '';
  soloDestacados: boolean = false;
  filtroSubrubro: string = '';
  subrubros: string[] = [];
  rubros: string[] = [];
  precioMin: number | null = null;
  precioMax: number | null = null;
  filtroMarca: string = '';
  marcas: string[] = [];

  paginaActual: number = 1;
  itemsPorPagina: number = 10;
  productosPaginados: Producto[] = [];
  public esMayorista: boolean = false;

  //public productos: Producto[] = [];

  constructor(private productosService: ProductosService, private authService: AuthService) { }

  ngOnInit(): void {

  this.authService.getUsuarioActual().subscribe(cliente => {
    this.esMayorista = cliente?.esMayorista ?? false;

    this.productosService.obtenerProductos().subscribe(productos => {
      this.productosOriginal = productos;
      this.rubros = [...new Set(productos.map(p => p.rubro))];
      this.marcas = [...new Set(productos.map(p => p.marca))];
      this.filtrarProductos();
    });
  });
  }

  filtrarProductos() {
    if (this.filtroRubro) {
      this.subrubros = [
        ...new Set(
          this.productosOriginal
            .filter(p => p.rubro === this.filtroRubro)
            .map(p => p.subrubro)
        )
      ];
    } else {
      this.subrubros = [];
      this.filtroSubrubro = '';
    }

    this.productosFiltrados = this.productosOriginal.filter(p => {
      const tipoVentaOk = this.esMayorista ? p.ventaMayorista : p.ventaMinorista;
      const rubroOk = this.filtroRubro ? p.rubro === this.filtroRubro : true;
      const subrubroOk = this.filtroSubrubro ? p.subrubro === this.filtroSubrubro : true;
      const destacadoOk = this.soloDestacados ? p.destacado === true : true;
      const precioMinOk = this.precioMin !== null ? p.precioMinorista >= this.precioMin : true;
      const precioMaxOk = this.precioMax !== null ? p.precioMinorista <= this.precioMax : true;
      const marcaOk = this.filtroMarca ? p.marca === this.filtroMarca : true;

      return tipoVentaOk && rubroOk && subrubroOk && destacadoOk && precioMinOk && precioMaxOk && marcaOk;
    });

    this.paginaActual = 1; // resetea a la primera página al aplicar filtros
    this.actualizarPaginados();
  }

  actualizarPaginados() {
    const inicio = (this.paginaActual - 1) * this.itemsPorPagina;
    const fin = inicio + this.itemsPorPagina;
    this.productosPaginados = this.productosFiltrados.slice(inicio, fin);
  }

  cambiarPagina(pagina: number) {
    this.paginaActual = pagina;
    this.actualizarPaginados();
  }



}
