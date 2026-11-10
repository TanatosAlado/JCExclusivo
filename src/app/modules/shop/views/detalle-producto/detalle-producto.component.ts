import { Component } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { GeneralService } from 'src/app/shared/services/general.service';
import { Producto, VarianteProducto } from '../../models/producto.model';
import { ToastService } from 'src/app/shared/services/toast.service';
import { MatDialog } from '@angular/material/dialog';
import { LoginComponent } from 'src/app/modules/auth/views/login/login.component';
import { Cliente } from 'src/app/modules/auth/models/cliente.model';
import { ProductosService } from '../../services/productos.service';
import { InfoEmpresaService } from 'src/app/shared/services/info-empresa.service';
import { fotosDe, unicas } from 'src/app/shared/utils/fotos';
import { AnalyticsService } from 'src/app/shared/services/analytics.service';
import { itemAnalytics } from 'src/app/shared/utils/analytics-tienda';

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
  // sinStock: boolean = false;
  origen: string = '/inicio';
  
  estadoAnterior: any = null;
  dolar = 1; // fallback por si no carga



  constructor(
    private analytics: AnalyticsService,
    private route: ActivatedRoute,
    private generalService: GeneralService,
    private toastService: ToastService,
    private dialog: MatDialog,
    private router: Router,
    private productosService: ProductosService,
    private infoEmpresaService: InfoEmpresaService,
  ) {}

  ngOnInit() {

      this.infoEmpresaService.obtenerInfoGeneral().subscribe(info => {
        if (info?.dolar) {
          this.dolar = info.dolar;
        }
      });

    if (history.state) {

      this.origen = history.state.origen || '/inicio';

      this.estadoAnterior = history.state.filtros || null;
    }


    const cliente = this.generalService.getClienteActual();
    this.esMayorista = cliente?.esMayorista ?? false; 

    this.route.params.subscribe(params => {
      const idProducto = params['id'];

      this.productosService.getProductoAgrupadoById(idProducto).subscribe(data => {
        if (!data) return;

        this.producto = data;
        this.configurarVariantes();

        // Analytics: una vez por producto (no cada vez que se actualiza el stock)
        if (this.productoVisto !== data.id) {
          this.productoVisto = data.id;
          this.analytics.verProducto(itemAnalytics(data, this.precioVisible, 1));
        }
      });
    });
  }


configurarVariantes() {

  this.indiceFoto = 0;

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

        // ✅ NUEVO: heredar stock mayorista
      if (v.stockMayorista == null) {
        v.stockMayorista = this.producto.stockMayorista ?? 0;
      }
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
    //  this.sinStock = this.selectedVariante?.stockTotal === 0;
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
  this.indiceFoto = 0;   // vuelve a la primera foto (la de la variante)

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
  //  this.sinStock = this.selectedVariante?.stockTotal === 0;
  }
}


seleccionarVariante(variante: VarianteProducto) {

  this.selectedVariante = variante;
  this.indiceFoto = 0;   // vuelve a la primera foto (la de la variante)

  const totalStock = this.stockVisible;


//  this.sinStock = totalStock <= 0;

  // ⚡ Ajustamos cantidad si supera el stock
  if (this.cantidad > totalStock) {
    this.cantidad = totalStock;
  }

  // ⚡ Si la variante NO tiene stock, forzamos cantidad a 1
  if (totalStock === 0) {
    this.cantidad = 1;
  }
}


  disminuirCantidad() {
    if (this.cantidad > 1) this.cantidad--;
  }

  aumentarCantidad() {
    const limite = this.stockVisible;

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
  console.log('Producto a agregar al carrito desde detalle:', producto);

  // 👉 Si hay variante, ESA variante es el producto real.
  // const productoFinal: any = this.selectedVariante ?? producto;

    const productoFinal: any = {
    ...producto,
    ...(this.selectedVariante ?? {})
  };

  console.log('Producto final a agregar al carrito:', productoFinal);

  this.generalService.cargarProductoCarrito(productoFinal, this.cantidad)
    .then(() => {
      this.toastService.toastMessage('Producto agregado al carrito', 'green', 2000);
      this.analytics.agregarAlCarrito(itemAnalytics(productoFinal, this.precioVisible, this.cantidad));
    })
    .catch(err => {

      console.error('Error al agregar producto:', err);

      if (err?.tipo === 'STOCK_INSUFICIENTE') {

        const disponiblesParaAgregar = err.stockDisponible - err.cantidadEnCarrito;

        this.toastService.toastMessage(
          `Stock insuficiente. 
          Ya tenés ${err.cantidadEnCarrito} unidad(es) en el carrito.
          Solo podés agregar ${disponiblesParaAgregar} unidad(es) más.`,
          'orange',
          4500
        );

        return;
      }

      this.toastService.toastMessage(
        'No se pudo agregar el producto al carrito. Intentá nuevamente.',
        'red',
        3000
      );
    })
}

volverATienda() {
  //this.router.navigate([this.origen]);

  this.router.navigate(
    [this.origen],
    {
      state: {
        filtrosRestaurar: this.estadoAnterior
      }
    }
  );
  
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

    let precio = 0;
    let moneda: 'ARS' | 'USD' = 'ARS';

    // 🔹 Si hay variante seleccionada
    if (this.selectedVariante) {

      precio = this.esMayorista
        ? this.selectedVariante.precioMayorista || 0
        : this.selectedVariante.precioMinorista || 0;

      moneda = this.selectedVariante.moneda || this.producto.moneda;
    }

    // 🔹 Producto normal
    else {

      precio = this.esMayorista
        ? this.producto.precioMayorista || 0
        : this.producto.precioMinorista || 0;

      moneda = this.producto.moneda;
    }

    // 🔥 Conversión USD → ARS
    if (moneda === 'USD') {
      return precio * this.dolar;
    }

    return precio;
  }

/** Último producto registrado en Analytics */
private productoVisto: string | null = null;

get imagenVisible(): string {
  const fotos = this.fotos;
  return fotos[this.indiceFoto] || fotos[0] || this.selectedVariante?.imagen || this.producto?.imagen;
}

// =====================================================
// FOTOS (varias: flechas, miniaturas y galería en grande)
// =====================================================

indiceFoto = 0;
verGaleria = false;

/** Primero la foto de la variante elegida (si tiene) y después la galería del producto */
get fotos(): string[] {
  return unicas([this.selectedVariante?.imagen, ...fotosDe(this.producto as any)]);
}

cambiarFoto(dir: number, evento?: Event) {
  evento?.stopPropagation();
  const n = this.fotos.length;
  if (n < 2) return;
  this.indiceFoto = (this.indiceFoto + dir + n) % n;
}

irAFoto(i: number) {
  this.indiceFoto = i;
}

abrirGaleria() {
  if (this.fotos.length) this.verGaleria = true;
}



get stockVisible(): number {

  // 👉 Si hay variante seleccionada
  if (this.selectedVariante) {
    return this.esMayorista
      ? (this.selectedVariante.stockMayorista ?? 0)
      : (this.selectedVariante.stockTotal ?? 0);
  }

  // 👉 Producto sin variantes
  return this.esMayorista
    ? (this.producto.stockMayorista ?? 0)
    : (this.producto.stockTotal ?? 0);
}


get sinStock(): boolean {
  return this.stockVisible <= 0;
}

}
