import { Component } from '@angular/core';
import { Producto } from '../../models/producto.model';
import { ProductosService } from '../../services/productos.service';
import { AuthService } from 'src/app/modules/auth/services/auth.service';
import { ActivatedRoute } from '@angular/router';
import { EquiposService, RUBRO_EQUIPOS } from 'src/app/modules/admin/services/equipos.service';
import { InfoEmpresaService } from 'src/app/shared/services/info-empresa.service';
import { precioEquipoEnPesos, cotizacionEquipos } from 'src/app/shared/utils/equipos-tienda';
import { AnalyticsService } from 'src/app/shared/services/analytics.service';

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

  /** 📱 En el celular los filtros arrancan cerrados (se abren con el botón "Filtros") */
  mostrarFiltros = false;

  /** Cuántos filtros hay aplicados (sin contar el buscador) */
  get filtrosActivos(): number {
    return [this.filtroRubro, this.filtroSubrubro, this.filtroMarca, this.soloDestacados,
      this.precioMin != null && (this.precioMin as any) !== '', this.precioMax != null && (this.precioMax as any) !== '']
      .filter(Boolean).length;
  }

  limpiarFiltros() {
    this.filtroRubro = '';
    this.filtroSubrubro = '';
    this.filtroMarca = '';
    this.precioMin = null;
    this.precioMax = null;
    this.soloDestacados = false;
    this.filtrarProductos();
  }
  //public productos: Producto[] = [];

  /** 📱 Equipos disponibles (se muestran como un rubro más: "Equipos") */
  private equiposTienda: any[] = [];
  private productosSolo: Producto[] = [];
  dolar = 0;

  constructor(
    private analytics: AnalyticsService,
    private productosService: ProductosService,
    private authService: AuthService,
    private route: ActivatedRoute,
    private equiposService: EquiposService,
    private infoEmpresaService: InfoEmpresaService
  ) { }

  /** Equipo convertido al formato de la grilla (para filtros y búsqueda) */
  private equipoComoProducto(e: any): any {
    return {
      id: e.id,
      esEquipo: true,
      equipo: e,
      descripcion: [e.modelo, e.capacidad, e.color, e.condicion === 'nuevo' ? 'nuevo' : 'usado', e.grado ? 'grado ' + e.grado : '']
        .filter(Boolean).join(' '),
      rubro: RUBRO_EQUIPOS,
      subrubro: '',
      marca: '',
      ventaMinorista: true,
      ventaMayorista: true,
      destacado: false,
      imagen: e.imagen || ''
    };
  }

  /** Productos + equipos (los equipos van al final; con el filtro de rubro "Equipos" se ven solos) */
  private unirCatalogo() {
    this.productosOriginal = [...this.productosSolo, ...this.equiposTienda.map(e => this.equipoComoProducto(e))];
    this.rubros = [...new Set(this.productosOriginal.map(p => p.rubro))];
    this.marcas = [...new Set(this.productosSolo.map(p => p.marca))];
  }

  private async cargarEquipos() {
    try {
      this.equiposTienda = await this.equiposService.listarDisponibles();
    } catch (e) {
      console.error('No se pudieron cargar los equipos', e);
      this.equiposTienda = [];
    }
    this.unirCatalogo();
    this.filtrarProductos(false);
  }

  ngOnInit(): void {

    this.infoEmpresaService.obtenerInfoGeneral().subscribe(info => {
      this.dolar = cotizacionEquipos(info);   // dólar JC (para filtrar equipos por precio)
    });
    this.cargarEquipos();

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

        this.productosSolo = productos;
        this.unirCatalogo();

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

    // Analytics: qué buscan (se registra cuando dejan de escribir)
    this.analytics.buscar(this.filtroNombre);

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

      // 👇 precio correcto según tipo de cliente (los equipos, convertidos a pesos)
      const precios = (p as any).esEquipo
        ? [precioEquipoEnPesos((p as any).equipo, this.esMayorista, this.dolar)]
        : p.variantes?.length
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
