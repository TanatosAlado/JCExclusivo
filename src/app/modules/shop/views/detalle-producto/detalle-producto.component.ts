import { Component } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { GeneralService } from 'src/app/shared/services/general.service';
import { Producto, VarianteProducto } from '../../models/producto.model';
import { ToastService } from 'src/app/shared/services/toast.service';
import { MatDialog } from '@angular/material/dialog';
import { LoginComponent } from 'src/app/modules/auth/views/login/login.component';
import { Cliente } from 'src/app/modules/auth/models/cliente.model';
import { ProductosService } from '../../services/productos.service';

@Component({
  selector: 'app-detalle-producto',
  templateUrl: './detalle-producto.component.html', 
  styleUrls: ['./detalle-producto.component.css']
})
export class DetalleProductoComponent {

  producto!: Producto;
  cantidad = 1;
  modelosUnicos: string[] = [];
  coloresFiltrados: VarianteProducto[] = [];
  modeloSeleccionado: string | null = null;
  selectedVariante: VarianteProducto | null = null;
  esMayorista: boolean = false;
  sinStock: boolean = false;



  constructor(
    private route: ActivatedRoute,
    private generalService: GeneralService,
    private toastService: ToastService,
    private dialog: MatDialog,
    private router: Router,
    private productosService: ProductosService
  ) {}

  ngOnInit() {
    this.route.params.subscribe(params => {
      const idProducto = params['id'];

      this.productosService.getProductoAgrupadoById(idProducto).subscribe(data => {

      if (!data) return;

      this.producto = data;
      this.configurarVariantes();
      });

    });
  }


configurarVariantes() {

  const variantes = this.producto.variantes || [];

  // 🔧 1. Normalizar stock + calcular stockTotal
  variantes.forEach((v: any) => {

    if (v.stockSucursales && !Array.isArray(v.stockSucursales)) {
      v.stockSucursales = Object.values(v.stockSucursales).map((cantidad: any) => ({
        cantidad
      }));
    }

    v.stockTotal =
      v.stockSucursales?.reduce(
        (acc: number, s: any) => acc + (s.cantidad || 0),
        0
      ) ?? 0;
  });

  // 🔍 2. Inferir tipo de variantes si no existe
  if (!this.producto.tipoVariantes) {
    const tieneModelo = variantes.some(v => !!v.modelo);
    const tieneColor  = variantes.some(v => v.color !== null && v.color !== undefined);

    if (tieneModelo && tieneColor) {
      this.producto.tipoVariantes = 'modelo+color';
    } else if (tieneModelo) {
      this.producto.tipoVariantes = 'modelo';
    } else if (tieneColor) {
      this.producto.tipoVariantes = 'color';
    } else {
      this.producto.tipoVariantes = 'none';
    }
  }

  // 🧠 3. Configurar según tipo
  switch (this.producto.tipoVariantes) {

    // 🟣 MODELO + COLOR
    case 'modelo+color':
      this.modelosUnicos = Array.from(
        new Set(variantes.map(v => v.modelo).filter(Boolean))
      );

      this.modeloSeleccionado = this.modelosUnicos[0] || null;

      this.coloresFiltrados = variantes.filter(
        v => v.modelo === this.modeloSeleccionado
      );
      break;

    // 🔵 SOLO MODELO
    case 'modelo':
      this.modelosUnicos = variantes.map(v => v.modelo).filter(Boolean);

      // Seleccionamos automáticamente la primera variante
      this.selectedVariante = variantes[0] || null;
      this.sinStock = this.selectedVariante?.stockTotal === 0;
      break;

    // 🟢 SOLO COLOR
    case 'color':
      this.coloresFiltrados = variantes;
      break;

    // ⚪ SIN VARIANTES
    default:
      this.modelosUnicos = [];
      this.coloresFiltrados = [];
      this.selectedVariante = variantes[0] || null;
      break;
  }
}



seleccionarModelo(modelo: string) {
  this.modeloSeleccionado = modelo;

  const variantesModelo =
    this.producto.variantes?.filter(v => v.modelo === modelo) || [];

  // 🟣 MODELO + COLOR
  if (this.producto.tipoVariantes === 'modelo+color') {
    this.coloresFiltrados = variantesModelo;
    this.selectedVariante = null; // acá sí corresponde
    return;
  }

  // 🔵 SOLO MODELO
  if (this.producto.tipoVariantes === 'modelo') {
    this.selectedVariante = variantesModelo[0] || null;
    this.sinStock = this.selectedVariante?.stockTotal === 0;
  }
}


seleccionarVariante(variante: VarianteProducto) {

  this.selectedVariante = variante;

  const totalStock = variante.stockTotal ?? 0;
  this.sinStock = totalStock <= 0;

  // ⚡ Ajustamos cantidad si supera el stock
  if (this.cantidad > totalStock) {
    this.cantidad = totalStock;
  }

  // ⚡ Si la variante NO tiene stock, forzamos cantidad a 1
  if (totalStock === 0) {
    this.cantidad = 1;
  }

  // Actualizamos datos dinámicamente
  // this.producto.imagen = variante.imagen || this.producto.imagen;
  // this.producto.precioMinorista = variante.precioMinorista || this.producto.precioMinorista;
  // this.producto.precioMayorista = variante.precioMayorista || this.producto.precioMayorista;
}


  disminuirCantidad() {
    if (this.cantidad > 1) this.cantidad--;
  }

aumentarCantidad() {
  const limite = this.selectedVariante?.stockTotal ?? this.producto.stockTotal;

  if (this.cantidad < limite) {
    this.cantidad++;
  }
}
  cargaCarrito(producto: Producto) {
    const cliente = this.generalService.getClienteActual();
    if (!cliente) {
      const dialogRef = this.dialog.open(LoginComponent, {
        width: '400px',
        disableClose: true,
        backdropClass: 'custom-backdrop',
        panelClass: 'custom-dialog'
      });

      dialogRef.afterClosed().subscribe((clienteLogueado: Cliente) => {
        if (clienteLogueado) {
          this.generalService.setCliente(clienteLogueado);
          localStorage.setItem('cliente', JSON.stringify(clienteLogueado));
          this.procesarProductoEnCarrito(clienteLogueado, producto);
        } else {
          this.toastService.toastMessage(
            'Debes iniciar sesión o continuar como invitado para agregar productos al carrito.',
            'orange',
            3000
          );
        }
      });

      return;
    }

    this.procesarProductoEnCarrito(cliente, producto);
  }

private procesarProductoEnCarrito(cliente: Cliente, producto: Producto) {

  // 👉 Si hay variante, ESA variante es el producto real.
  const productoFinal: any = this.selectedVariante ?? producto;

  this.generalService.cargarProductoCarrito(productoFinal, this.cantidad)
    .then(() => {
      this.toastService.toastMessage('Producto agregado al carrito', 'green', 2000);
    })
    .catch(err => {
      this.toastService.toastMessage('El producto no pudo agregarse', 'red', 2000);
      console.error(err);
    });
}

volverATienda() {
  this.router.navigate(['/inicio']);   // 👉 Ajustá la ruta si tu tienda tiene otro path
}

puedeAgregar(): boolean {

  if (this.sinStock) return false;

  if (this.producto.tipoVariantes === 'none') return true;

  if (this.producto.tipoVariantes === 'color') {
    return this.selectedVariante !== null;
  }

  if (this.producto.tipoVariantes === 'modelo') {
    return this.selectedVariante !== null;  
  }

  if (this.producto.tipoVariantes === 'modelo+color') {
    return this.modeloSeleccionado !== null && this.selectedVariante !== null;
  }

  return true;
}


get precioVisible(): number {
  if (this.selectedVariante) {
    return this.esMayorista
      ? this.selectedVariante.precioMayorista
      : this.selectedVariante.precioMinorista;
  }

  return this.esMayorista
    ? this.producto.precioMayorista
    : this.producto.precioMinorista;
}

get imagenVisible(): string {
  return this.selectedVariante?.imagen || this.producto.imagen;
}


}
