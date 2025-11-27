import { Component } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { GeneralService } from 'src/app/shared/services/general.service';
import { Producto, VarianteProducto } from '../../models/producto.model';
import { ToastService } from 'src/app/shared/services/toast.service';
import { MatDialog } from '@angular/material/dialog';
import { LoginComponent } from 'src/app/modules/auth/views/login/login.component';
import { Cliente } from 'src/app/modules/auth/models/cliente.model';

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


  constructor(
    private route: ActivatedRoute,
    private generalService: GeneralService,
    private toastService: ToastService,
    private dialog: MatDialog,
    private router: Router
  ) {}

ngOnInit() {
  this.route.params.subscribe(async params => {
    const idProducto = params['id'];

    const data = await this.generalService.getProductoById(idProducto);
    if (!data) return;

    this.producto = data;
    console.log('🟢 Producto cargado:', this.producto);
    console.log('🔍 Variantes del producto:', this.producto.variantes);

    this.configurarVariantes();
  });
}


  configurarVariantes() {
    const variantes = this.producto.variantes || [];

    if (this.producto.tipoVariantes === 'modelo+color') {
      // Obtenemos todos los modelos únicos
      this.modelosUnicos = Array.from(new Set(variantes.map(v => v.modelo).filter(Boolean)));
      // Por defecto, mostramos los colores del primer modelo
      this.modeloSeleccionado = this.modelosUnicos[0] || null;
      this.coloresFiltrados = variantes.filter(v => v.modelo === this.modeloSeleccionado);
    } else if (this.producto.tipoVariantes === 'color') {
      this.coloresFiltrados = variantes;
    }
  }

  seleccionarModelo(modelo: string) {
    this.modeloSeleccionado = modelo;
    this.coloresFiltrados = this.producto.variantes?.filter(v => v.modelo === modelo) || [];
    this.selectedVariante = null; // Reiniciamos selección de color
  }

  seleccionarVariante(variante: VarianteProducto) {
    this.selectedVariante = variante;
    // Actualizamos datos dinámicamente
    this.producto.imagen = variante.imagen || this.producto.imagen;
    this.producto.precioMinorista = variante.precioMinorista || this.producto.precioMinorista;
    this.producto.precioMayorista = variante.precioMayorista || this.producto.precioMayorista;
    this.producto.precioOferta = this.producto.precioOferta;
    this.producto.oferta = this.producto.oferta;
  }

  disminuirCantidad() {
    if (this.cantidad > 1) this.cantidad--;
  }

  aumentarCantidad() {
    this.cantidad++;
  }

  cargaCarrito(producto: Producto) {
    console.log('Agregando al carrito desde Detalle:', producto);
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
  // Si hay variante seleccionada, combinamos sus datos con el producto base
  const productoFinal: Producto = this.selectedVariante
    ? {
        ...producto,
        ...this.selectedVariante,
        id: `${producto.id}-${this.selectedVariante.modelo || this.selectedVariante.color || 'base'}`,
        stockTotal: producto.stockTotal || 0,
        stockGlobal: producto.stockGlobal || 0
      } as Producto
    : producto;

  console.log('🛒 Agregando al carrito:', productoFinal);

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


}
