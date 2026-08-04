import { Component, ElementRef, ViewChild } from '@angular/core';
import { Sucursal } from 'src/app/modules/admin/models/sucursal.model';
import { SucursalesService } from 'src/app/modules/admin/services/sucursales.service';
import { ProductosCacheService } from 'src/app/modules/despacho/services/productos-cache.service';
import { Producto } from 'src/app/modules/shop/models/producto.model';
import { ProductosService } from 'src/app/modules/shop/services/productos.service';
import Swal from 'sweetalert2';

@Component({
  selector: 'app-ingreso-stock',
  templateUrl: './ingreso-stock.component.html',
  styleUrls: ['./ingreso-stock.component.css']
})
export class IngresoStockComponent {


  @ViewChild('codigo')
  codigoInput!: ElementRef<HTMLInputElement>;
  textoBusqueda = '';
  // productoSeleccionado!: Producto;
  productosEncontrados: Producto[] = [];
  productoSeleccionado: Producto | null = null;
  ingresoSucursales: { [idSucursal: string]: number } = {};
  ingresoMayorista = 0;
  sucursales: Sucursal[] = [];
  destinoSeleccionado: string = ''; 
  cantidadIngreso: number = 1;
  cantidadIngresar = 0;
  guardando = false;


  constructor(
    private productosCache: ProductosCacheService,
    private sucursalesService: SucursalesService,
    private productosService: ProductosService
  ) {}


  ngOnInit(): void {
    this.sucursalesService.obtenerSucursales().subscribe(resp => {
      this.sucursales = resp;
    });
  }

  async buscarDescripcion() {
    if (this.textoBusqueda.length < 3) {
      this.productosEncontrados = [];
      return;
    }
    this.productosEncontrados =
      await this.productosCache.buscarProductos(this.textoBusqueda);
  }

  seleccionarProducto(producto: Producto) {

     console.log(producto.descripcion);
  console.log(producto.stockSucursales);
  console.log(Array.isArray(producto.stockSucursales));

    this.productoSeleccionado = producto;
    // Inicializamos los inputs en cero
    this.ingresoSucursales = {};

    (producto.stockSucursales || []).forEach(stock => {
      this.ingresoSucursales[stock.sucursalId] = 0;
    });
    this.ingresoMayorista = 0;

    // Ocultamos resultados
    this.productosEncontrados = [];
    this.textoBusqueda = '';
  }

  async buscarCodigo(codigo: string) {
    console.log('codigo:', codigo)
    if (!codigo.trim()) {
      return;
    }
    const producto = await this.productosCache.getProductoPorCodigo(codigo);
    if (producto) {
      this.seleccionarProducto(producto);
    } else {
      this.productosEncontrados = [];
      console.log('no se encontro')
    }
  }

  obtenerNombreSucursal(id: string): string {
    const sucursal = this.sucursales.find(s => s.id === id);
    return sucursal?.nombre || id;
  }

  async ingresarStock() {

    this.guardando = true;
    if (!this.productoSeleccionado) {
      return;
    }

    this.guardando = true;

    try {

      // Creamos una copia para no modificar el objeto mostrado en pantalla
      const producto: Producto = structuredClone(this.productoSeleccionado);

      if (this.destinoSeleccionado === 'MAYORISTA') {
        producto.stockMayorista += this.cantidadIngresar;
      } else {

        const stockSucursal = producto.stockSucursales.find(
          s => s.sucursalId === this.destinoSeleccionado
        );

        if (stockSucursal) {
          stockSucursal.cantidad += this.cantidadIngresar;
        }
      }

      await this.productosService.actualizarProducto(producto);

      await Swal.fire({
          icon: 'success',
          title: 'Stock actualizado',
          html: `
              <b>${this.cantidadIngresar}</b> unidades ingresadas correctamente.<br><br>
              Destino:<br>
              <b>${
                  this.destinoSeleccionado === 'MAYORISTA'
                      ? 'Stock Mayorista'
                      : this.obtenerNombreSucursal(this.destinoSeleccionado)
              }</b>
          `,
          timer: 1700,
          timerProgressBar: true,
          showConfirmButton: false
      });

      this.productoSeleccionado = producto;
      this.destinoSeleccionado = '';
      this.cantidadIngresar = 0;

      this.limpiarFormulario();

    } finally {
      this.guardando = false;
    }
    this.guardando = false;
  }

  private limpiarFormulario(): void {
    this.productoSeleccionado = null;
    this.productosEncontrados = [];
    this.textoBusqueda = '';
    this.destinoSeleccionado = '';
    this.cantidadIngresar = 0;
    this.ingresoSucursales = {};
    this.ingresoMayorista = 0;
    this.codigoInput.nativeElement.value = '';
    this.enfocarCodigo();
  }

  private enfocarCodigo(): void {
    setTimeout(() => {
      this.codigoInput?.nativeElement.focus();
      this.codigoInput?.nativeElement.select();
    }, 100);
  }

}
