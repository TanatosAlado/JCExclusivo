import { Component } from '@angular/core';
import { Producto } from '../../models/producto.model';
import { ProductosService } from '../../services/productos.service';
import { AuthService } from 'src/app/modules/auth/services/auth.service';
import { ActivatedRoute } from '@angular/router';

@Component({
  selector: 'app-grilla-item',
  templateUrl: './grilla-item.component.html',
  styleUrls: ['./grilla-item.component.css']
})
export class GrillaItemComponent {

  Math = Math;
  window = window;

  

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

  readonly MAX_BOTONES = 5;

  productosPaginados: Producto[] = [];
  public esMayorista: boolean = false;

  scrollActual: number = 0;
  //public productos: Producto[] = [];

  constructor(private productosService: ProductosService, private authService: AuthService, private route: ActivatedRoute) { }

  ngOnInit(): void {

     this.route.queryParams.subscribe(params => {

    const rubro = params['rubro'];

    if (rubro) {

      this.filtroRubro = rubro;

      this.filtrarProductos();

    }

  });

    const estado = history.state.filtrosRestaurar;

    this.authService.getUsuarioActual().subscribe(cliente => {

      this.esMayorista = cliente?.esMayorista ?? false;

      this.productosService.obtenerProductosAgrupados().subscribe(productos => {

        this.productosOriginal = productos;

        this.rubros = [...new Set(productos.map(p => p.rubro))];
        this.marcas = [...new Set(productos.map(p => p.marca))];

        // 🔥 restaurar filtros
        if (estado) {

          this.filtroNombre = estado.filtroNombre;
          this.filtroRubro = estado.filtroRubro;
          this.filtroSubrubro = estado.filtroSubrubro;
          this.filtroMarca = estado.filtroMarca;
          this.precioMin = estado.precioMin;
          this.precioMax = estado.precioMax;
          this.soloDestacados = estado.soloDestacados;
          this.paginaActual = estado.paginaActual;
        }

        this.filtrarProductos(false);

        // 🔥 restaurar scroll
        setTimeout(() => {

          if (estado?.scrollY) {
            window.scrollTo(0, estado.scrollY);
          }

        }, 100);

      });

    });

  }
  

  filtrarProductos(resetPagina: boolean = true) {

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
      const marcaOk = this.filtroMarca ? p.marca === this.filtroMarca : true;
      const nombreOk = this.filtroNombre
      ? this.coincideBusqueda(p.descripcion, this.filtroNombre)
      : true;

      // 👇 precio correcto según tipo de cliente
      const precios = p.variantes?.length
        ? p.variantes.map(v =>
          this.esMayorista ? v.precioMayorista : v.precioMinorista
        )
        : [this.esMayorista ? p.precioMayorista : p.precioMinorista];

      const preciosValidos = precios.filter(pr => typeof pr === 'number' && pr > 0);

      const precioMinOk = this.precioMin !== null
        ? preciosValidos.some(pr => pr >= this.precioMin!)
        : true;

      const precioMaxOk = this.precioMax !== null
        ? preciosValidos.some(pr => pr <= this.precioMax!)
        : true;

      return tipoVentaOk && rubroOk && subrubroOk && destacadoOk && precioMinOk && precioMaxOk && marcaOk && nombreOk;
    });

    if (resetPagina) {
      this.paginaActual = 1;
    }
   // this.paginaActual = 1; // resetea a la primera página al aplicar filtros
    this.actualizarPaginados();
  }

  actualizarPaginados() {
    const inicio = (this.paginaActual - 1) * this.itemsPorPagina;
    const fin = inicio + this.itemsPorPagina;
    this.productosPaginados = this.productosFiltrados.slice(inicio, fin);
  }

  cambiarPagina(pagina: number) {

    if (pagina < 1 || pagina > this.totalPaginas) {
      return;
    }

    this.paginaActual = pagina;
    this.actualizarPaginados();

    window.scroll({
      top: 0,
      behavior: 'smooth'
    });

  }

  get totalPaginas(): number {
    return Math.ceil(this.productosFiltrados.length / this.itemsPorPagina);
  }


  get paginas(): (number | string)[] {

    const total = this.totalPaginas;

    if (total <= 7) {
      return Array.from({ length: total }, (_, i) => i + 1);
    }

    const paginas: (number | string)[] = [];

    paginas.push(1);

    let inicio = Math.max(2, this.paginaActual - 2);
    let fin = Math.min(total - 1, this.paginaActual + 2);

    if (this.paginaActual <= 4) {
      fin = 5;
    }

    if (this.paginaActual >= total - 3) {
      inicio = total - 4;
    }

    if (inicio > 2) {
      paginas.push('...');
    }

    for (let i = inicio; i <= fin; i++) {
      paginas.push(i);
    }

    if (fin < total - 1) {
      paginas.push('...');
    }

    paginas.push(total);

    return paginas;
  }

  private normalizarTexto(texto: string): string {
    return texto
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // elimina tildes
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ');
  }  

  private coincideBusqueda(descripcion: string | undefined, busqueda: string): boolean {
    if (!descripcion) {
      return false;
    }

    const texto = this.normalizarTexto(descripcion);
    const palabras = this.normalizarTexto(busqueda).split(' ');

    return palabras.every(palabra => texto.includes(palabra));
  }

}
