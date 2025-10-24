import { Component, Input, ViewEncapsulation } from '@angular/core';
import { Producto } from '../../models/producto.model';
import { GeneralService } from 'src/app/shared/services/general.service';
import { ToastService } from 'src/app/shared/services/toast.service';
import { MatDialog } from '@angular/material/dialog';
import { LoginComponent } from 'src/app/modules/auth/views/login/login.component';
import { Cliente } from 'src/app/modules/auth/models/cliente.model';
import { Router } from '@angular/router';

@Component({
  selector: 'app-item',
  templateUrl: './item.component.html',
  styleUrls: ['./item.component.css'],
  encapsulation: ViewEncapsulation.None
})
export class ItemComponent {

  @Input() producto!: Producto;
  @Input() esMayorista: boolean = false;
  loadingCarrito: { [id: string]: boolean } = {};

  selectedVariante: any = null;   // objeto que representará la "versión" seleccionada
  selectedColor: string = '';

  constructor(
    private generalService: GeneralService,
    private toastService: ToastService,
    private dialog: MatDialog,
    private router: Router
  ) { }

  ngOnInit() {
    // Por defecto el color principal queda seleccionado
    // this.selectedVariante = { ...this.producto };
    // this.selectedColor = this.producto.color;
    this.seleccionarColorPrincipal();
  }


  private buildProductoSeleccionado(variante?: any) {
    // Datos base del producto (campos mínimos que tu carrito/servicios esperan)
    const base = {
      id: this.producto.id,
      codigoBarras: this.producto.codigoBarras,
      descripcion: this.producto.descripcion,
      precioCosto: this.producto.precioCosto,
      ventaMinorista: this.producto.ventaMinorista,
      precioMinorista: this.producto.precioMinorista,
      ventaMayorista: this.producto.ventaMayorista,
      precioMayorista: this.producto.precioMayorista,
      imagen: this.producto.imagen,
      rubro: this.producto.rubro,
      subrubro: this.producto.subrubro,
      marca: this.producto.marca,
      oferta: this.producto.oferta,
      precioOferta: this.producto.precioOferta,
      precioSinImpuestos: this.producto.precioSinImpuestos,
      stockMinimo: this.producto.stockMinimo,
      stockSucursales: this.producto.stockSucursales || [],
      stockMayorista: this.producto.stockMayorista || 0,
      color: this.producto.color || '',      // color principal por defecto
      // cualquier otro campo que necesites
    };

    if (!variante) {
      return base;
    }

    // Si existe variante, sobrescribimos solo lo necesario (codigoBarras, color, stocks, imagen si la variante la tiene)
    return {
      ...base,
      codigoBarras: variante.codigoBarras ?? base.codigoBarras,
      color: variante.color ?? base.color,
      stockSucursales: variante.stockSucursales ?? base.stockSucursales,
      stockMayorista: typeof variante.stockMayorista !== 'undefined' ? variante.stockMayorista : base.stockMayorista,
      imagen: variante.imagen ?? base.imagen
    };
  }

  calcularDescuento(producto: Producto): number {
    const precioBase = this.esMayorista ? producto.precioMayorista : producto.precioMinorista;
    if (producto.oferta && producto.precioOferta < precioBase) {
      const descuento = 100 - (producto.precioOferta * 100) / precioBase;
      return Math.round(descuento);
    }
    return 0;
  }

  // 🔹 Al agregar al carrito, usamos la variante seleccionada
  agregarCarrito() {
    const productoSeleccionado = this.selectedVariante || this.buildProductoSeleccionado(undefined);
    console.log('Agregando al carrito (seleccionado):', productoSeleccionado);

    const cliente = this.generalService.getClienteActual();
    this.loadingCarrito[productoSeleccionado.id] = true;

    const finalizar = () => this.loadingCarrito[productoSeleccionado.id] = false;

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
          this.procesarProductoEnCarrito(clienteLogueado, productoSeleccionado, finalizar);
        } else {
          this.toastService.toastMessage(
            'Debes iniciar sesión o continuar como invitado para agregar productos al carrito.',
            'orange',
            3000
          );
          finalizar();
        }
      });

      return;
    }

    this.procesarProductoEnCarrito(cliente, productoSeleccionado, finalizar);
  }


  private procesarProductoEnCarrito(cliente: Cliente, producto: Producto, finalizar: () => void) {
    this.generalService.cargarProductoCarrito(producto, 1)
      .then(() => {
        this.toastService.toastMessage('Producto agregado al carrito', 'green', 2000);
      })
      .catch(err => {
        this.toastService.toastMessage('El producto no pudo agregarse', 'red', 2000);
        console.error(err);
      })
      .finally(finalizar);
  }

  // Navegamos al detalle usando el id (mejor que descripcion porque es único)
  verDetalle(producto: Producto) {
    this.router.navigate([`producto/${producto.id}`]);
  }

  // Selecciona una variante (cuando el usuario hace click en un circulito variante)
  seleccionarVariante(variante: any) {
    this.selectedColor = variante.color || '';
    this.selectedVariante = this.buildProductoSeleccionado(variante);
  }

  // Selecciona el color principal
  seleccionarColorPrincipal() {
    this.selectedColor = this.producto.color || '';
    this.selectedVariante = this.buildProductoSeleccionado(undefined); // sin variante -> base
  }


}
