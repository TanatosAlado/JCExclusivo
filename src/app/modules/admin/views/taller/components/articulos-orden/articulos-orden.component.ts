import { Component, ElementRef, Inject, OnInit, ViewChild } from '@angular/core';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';
import { take } from 'rxjs/operators';
import Swal from 'sweetalert2';
import {
  ArticulosOrdenService, ArticuloOrden, ArticuloOrdenError, stockMayorista, esDeMayorista
} from 'src/app/modules/admin/services/articulos-orden.service';
import { SucursalesService } from 'src/app/modules/admin/services/sucursales.service';
import { ProductosCacheService } from 'src/app/modules/despacho/services/productos-cache.service';

/**
 * Artículos de nuestro stock usados en una orden de reparación (puede tener varios).
 * Salen del STOCK MAYORISTA (está en el local donde se hacen las reparaciones).
 * Agregar descuenta el stock; devolver lo repone. No modifica el presupuesto de la orden.
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

  // Solo para mostrar artículos viejos que salieron del stock de una sucursal
  nombresSucursales: { [id: string]: string } = {};

  productos: any[] = [];
  cargandoProductos = false;

  // Código de barras: se escanea con la pistola (o se tipea) y Enter
  @ViewChild('inputCodigo') inputCodigo?: ElementRef<HTMLInputElement>;
  @ViewChild('inputBusqueda') inputBusqueda?: ElementRef<HTMLInputElement>;
  codigo = '';
  codigoNoEncontrado = '';
  /** Búsqueda por nombre: se habilita si el código no se encuentra (o si la piden) */
  modoBusqueda = false;

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
      (lista || []).forEach((s: any) => this.nombresSucursales[s.id] = s.nombre || s.id);
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
      this.enfocar('codigo');
    }
  }

  // =====================================================
  // CÓDIGO DE BARRAS
  // =====================================================

  /** Enter en el campo de código (la pistola manda el código + Enter) */
  buscarPorCodigo() {
    const codigo = String(this.codigo || '').trim();
    if (!codigo || this.cargandoProductos) return;
    const clave = codigo.toLowerCase();
    const producto = this.productos.find(p => String(p.codigoBarras ?? '').trim().toLowerCase() === clave);
    this.codigo = '';

    if (!producto) {
      // No está: se habilita la búsqueda por nombre
      this.codigoNoEncontrado = codigo;
      this.abrirBusqueda();
      return;
    }

    this.codigoNoEncontrado = '';
    this.modoBusqueda = false;
    this.busqueda = '';
    this.resultados = [];
    if (this.seleccionado?.id === producto.id) {
      // El mismo código otra vez: una unidad más
      this.cantidad = (Math.floor(Number(this.cantidad)) || 0) + 1;
    } else {
      this.elegir(producto);
    }
    if (this.stock(producto) <= 0) {
      Swal.fire({ toast: true, position: 'top-end', timer: 2500, showConfirmButton: false, icon: 'warning',
        title: `${producto.descripcion}: sin stock mayorista` });
    }
    this.enfocar('codigo');
  }

  /** Habilita el buscador por nombre (si no se encontró el código, o no lo tienen) */
  abrirBusqueda() {
    this.modoBusqueda = true;
    this.seleccionado = null;
    this.enfocar('busqueda');
  }

  cerrarBusqueda() {
    this.modoBusqueda = false;
    this.busqueda = '';
    this.resultados = [];
    this.codigoNoEncontrado = '';
    this.enfocar('codigo');
  }

  private enfocar(campo: 'codigo' | 'busqueda') {
    setTimeout(() => (campo === 'codigo' ? this.inputCodigo : this.inputBusqueda)?.nativeElement?.focus(), 50);
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

  /** Stock mayorista del producto */
  stock(p: any): number {
    return stockMayorista(p);
  }

  /** De qué stock salió un artículo ya cargado */
  origen(a: ArticuloOrden): string {
    return esDeMayorista(a) ? 'Mayorista' : (this.nombresSucursales[a.sucursalId || ''] || a.sucursalId || '-');
  }

  /** Total de unidades usadas (no devueltas) */
  get unidadesUsadas(): number {
    return this.activos.reduce((acc, a) => acc + (Number(a.cantidad) || 0), 0);
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
        this.seleccionado.id, cant);

      this.articulos = [...this.articulos, articulo];
      this.actualizarProductoLocal(producto);
      // Queda listo para escanear el próximo repuesto (la búsqueda por nombre queda armada si estaba abierta)
      this.seleccionado = null;
      this.codigoNoEncontrado = '';
      this.enfocar(this.modoBusqueda ? 'busqueda' : 'codigo');
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
      html: `<strong>${a.cantidad} x ${a.nombre}</strong><br>vuelve al stock ${esDeMayorista(a) ? 'mayorista' : 'de ' + this.origen(a)}.`,
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
        a.id, r.value.trim());
      this.articulos = this.articulos.map(x => x.id === a.id ? { ...x, devuelto: true, motivoDevolucion: r.value.trim() } : x);
      if (producto) this.actualizarProductoLocal(producto);
      else Swal.fire('Devuelto', 'El producto ya no existe, así que no se pudo reponer stock. Quedó marcado como devuelto.', 'info');
    } catch (e: any) {
      Swal.fire('No se pudo devolver', e?.message || '', 'warning');
    } finally {
      this.guardando = false;
    }
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
