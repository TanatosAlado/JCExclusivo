import { Component, Inject, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';
import { take } from 'rxjs/operators';
import Swal from 'sweetalert2';
import {
  ArticulosOrdenService, ArticuloOrden, ArticuloOrdenError, stockEnSucursal
} from 'src/app/modules/admin/services/articulos-orden.service';
import { SucursalesService } from 'src/app/modules/admin/services/sucursales.service';
import { ProductosCacheService } from 'src/app/modules/despacho/services/productos-cache.service';

const CLAVE_SUCURSAL = 'tallerSucursalArticulos';

/**
 * Artículos de nuestro stock usados en una orden de reparación.
 * Agregar descuenta el stock de la sucursal elegida; devolver lo repone.
 * No modifica el presupuesto de la orden.
 */
@Component({
  selector: 'app-articulos-orden',
  templateUrl: './articulos-orden.component.html',
  styleUrls: ['./articulos-orden.component.css']
})
export class ArticulosOrdenComponent implements OnInit {

  orden: any;
  coleccion: string;
  articulos: ArticuloOrden[] = [];

  sucursales: { id: string; nombre: string }[] = [];
  nombresSucursales: { [id: string]: string } = {};
  sucursalId = '';

  productos: any[] = [];
  cargandoProductos = false;
  busqueda = '';
  resultados: any[] = [];
  seleccionado: any = null;
  cantidad = 1;
  guardando = false;
  mostrarDevueltos = false;

  constructor(
    @Inject(MAT_DIALOG_DATA) data: { orden: any; coleccion: string },
    private articulosService: ArticulosOrdenService,
    private sucursalesService: SucursalesService,
    private productosCache: ProductosCacheService
  ) {
    this.orden = data.orden;
    this.coleccion = data.coleccion;
    this.articulos = [...(data.orden?.articulos || [])];
  }

  async ngOnInit() {
    this.sucursalesService.obtenerSucursales().pipe(take(1)).subscribe(lista => {
      this.sucursales = (lista || []).map((s: any) => ({ id: s.id, nombre: s.nombre || s.id }));
      this.sucursales.forEach(s => this.nombresSucursales[s.id] = s.nombre);
      let guardada = '';
      try { guardada = localStorage.getItem(CLAVE_SUCURSAL) || localStorage.getItem('sucursalSeleccionada') || ''; } catch { }
      this.sucursalId = this.sucursales.some(s => s.id === guardada) ? guardada : (this.sucursales[0]?.id || '');
      this.filtrar();
    });

    this.cargandoProductos = true;
    try {
      this.productos = await this.productosCache.getProductos();
      // Primera vez en esta PC (o cache vacía): se descargan
      if (!this.productos?.length) this.productos = await this.productosCache.syncProductos();
    } catch (e) {
      console.error('Error cargando productos', e);
    } finally {
      this.cargandoProductos = false;
    }
  }

  get activos(): ArticuloOrden[] {
    return this.articulos.filter(a => !a.devuelto);
  }

  get visibles(): ArticuloOrden[] {
    return this.mostrarDevueltos ? this.articulos : this.activos;
  }

  get cantidadDevueltos(): number {
    return this.articulos.length - this.activos.length;
  }

  cambiarSucursal() {
    try { localStorage.setItem(CLAVE_SUCURSAL, this.sucursalId); } catch { }
    this.filtrar();
  }

  stock(p: any): number {
    return stockEnSucursal(p, this.sucursalId);
  }

  /** Busca por descripción, código de barras, marca o modelo (varias palabras, sin tildes) */
  filtrar() {
    const norm = (t: any) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const palabras = norm(this.busqueda).split(/\s+/).filter(Boolean);
    if (!palabras.length) { this.resultados = []; return; }
    this.resultados = this.productos
      .filter(p => {
        const texto = norm([p.descripcion, p.codigoBarras, p.marca, p.modelo, p.categoria].join(' '));
        return palabras.every(w => texto.includes(w));
      })
      .sort((a, b) => (this.stock(b) > 0 ? 1 : 0) - (this.stock(a) > 0 ? 1 : 0)
        || String(a.descripcion).localeCompare(String(b.descripcion)))
      .slice(0, 15);
  }

  elegir(p: any) {
    this.seleccionado = p;
    this.cantidad = 1;
  }

  async agregar() {
    if (!this.seleccionado || this.guardando) return;
    const cant = Math.floor(Number(this.cantidad) || 0);
    if (cant <= 0) return;

    this.guardando = true;
    try {
      const { articulo, producto } = await this.articulosService.agregar(
        { id: this.orden.id, coleccion: this.coleccion, numeroOrden: this.orden.numeroOrden },
        this.seleccionado.id, this.sucursalId, cant, this.nombresSucursales[this.sucursalId]);

      this.articulos = [...this.articulos, articulo];
      this.actualizarProductoLocal(producto);
      this.seleccionado = null;
      this.busqueda = '';
      this.resultados = [];
      Swal.fire({ toast: true, position: 'top-end', timer: 2000, showConfirmButton: false, icon: 'success',
        title: `${cant} x ${articulo.nombre} descontado del stock` });
    } catch (e: any) {
      if (e instanceof ArticuloOrdenError) {
        Swal.fire('No se pudo agregar', e.message, 'warning');
        // Refrescamos el stock conocido del producto
        await this.refrescarProductos();
      } else {
        console.error(e);
        Swal.fire('Error', 'No se pudo agregar el artículo. ' + (e?.message || ''), 'error');
      }
    } finally {
      this.guardando = false;
    }
  }

  async devolver(a: ArticuloOrden) {
    const r = await Swal.fire({
      title: 'Devolver al stock',
      html: `<strong>${a.cantidad} x ${a.nombre}</strong><br>vuelve al stock de ${this.nombreSucursal(a.sucursalId)}.`,
      input: 'text',
      inputLabel: 'Motivo',
      inputPlaceholder: 'Ej: no se usó / cargado por error',
      inputValidator: (v: string) => (!v || v.trim().length < 3) ? 'Ingresá un motivo' : null,
      showCancelButton: true,
      confirmButtonText: 'Devolver',
      cancelButtonText: 'Cancelar'
    });
    if (!r.isConfirmed) return;

    this.guardando = true;
    try {
      const { producto } = await this.articulosService.devolver(
        { id: this.orden.id, coleccion: this.coleccion, numeroOrden: this.orden.numeroOrden },
        a.id, r.value.trim(), this.nombreSucursal(a.sucursalId));
      this.articulos = this.articulos.map(x => x.id === a.id ? { ...x, devuelto: true, motivoDevolucion: r.value.trim() } : x);
      if (producto) this.actualizarProductoLocal(producto);
      else Swal.fire('Devuelto', 'El producto ya no existe, así que no se pudo reponer stock. Quedó marcado como devuelto.', 'info');
    } catch (e: any) {
      Swal.fire('No se pudo devolver', e?.message || '', 'warning');
    } finally {
      this.guardando = false;
    }
  }

  nombreSucursal(id: string): string {
    return this.nombresSucursales[id] || id || '-';
  }

  private actualizarProductoLocal(producto: any) {
    if (!producto) return;
    this.productos = this.productos.map(p => p.id === producto.id ? { ...p, ...producto } : p);
    this.productosCache.actualizarProducto(producto).catch(() => { });
    this.filtrar();
  }

  private async refrescarProductos() {
    try {
      this.productos = await this.productosCache.syncProductos();
      if (this.seleccionado) this.seleccionado = this.productos.find(p => p.id === this.seleccionado.id) || null;
      this.filtrar();
    } catch { }
  }
}
