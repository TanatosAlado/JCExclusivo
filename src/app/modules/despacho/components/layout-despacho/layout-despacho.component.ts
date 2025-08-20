import { Component, OnInit } from '@angular/core';
import { Firestore, collection, query, where, getDocs, addDoc } from '@angular/fire/firestore';

interface ClientePOS {
  dni: string;
  nombre: string;
  tipo: 'minorista' | 'mayorista';
}

interface ProductoPOS {
  id: string;
  codigoBarras: string;
  nombre: string;
  precioMinorista: number;
  precioMayorista: number;
}

interface ItemCarritoPOS {
  productoId: string;
  nombre: string;
  cantidad: number;
  precioUnitario: number; // editable
  subtotal: number;
}

@Component({
  selector: 'app-layout-despacho',
  templateUrl: './layout-despacho.component.html',
  styleUrls: ['./layout-despacho.component.css']
})
export class LayoutDespachoComponent implements OnInit {

  // Array de productos para búsqueda manual
  productosFiltrados: ProductoPOS[] = [];


  // Cliente
  clienteActual: ClientePOS | null = null;
  tipoPrecio: 'minorista' | 'mayorista' = 'minorista';

  // Cache de productos
  productoCache: { [codigo: string]: ProductoPOS } = {};

  // Carrito
  carrito: ItemCarritoPOS[] = [];
  total: number = 0;

  // Control búsqueda manual
  modoBusquedaManual: boolean = false;
  busquedaManual: string = '';

  constructor(private firestore: Firestore) {}

  ngOnInit(): void {}

  /** Buscar cliente por DNI */
  async buscarClientePorDNI(dni: string) {
    const dniCliente = parseInt(dni, 10);
    const clientesRef = collection(this.firestore, 'Clientes');
    const q = query(clientesRef, where('dni', '==', dniCliente));
    const snap = await getDocs(q);

    if (!snap.empty) {
      const doc = snap.docs[0];
      const data = doc.data() as any;
      this.clienteActual = {
        dni: data.dni,
        nombre: data.nombre,
        tipo: data.tipoCliente || 'minorista'
      };
      this.tipoPrecio = this.clienteActual.tipo;
    } else {
      this.clienteActual = null;
      this.tipoPrecio = 'minorista';
    }
  }

  /** Escanear código de barras */
  async procesarCodigoBarras(codigo: string) {
    // Si el producto ya está en cache
    if (this.productoCache[codigo]) {
      this.agregarAlCarrito(this.productoCache[codigo]);
      return;
    }

    // Buscar en Firebase
    const productosRef = collection(this.firestore, 'productos');
    const q = query(productosRef, where('codigo', '==', codigo));
    const snap = await getDocs(q);

    if (!snap.empty) {
      const doc = snap.docs[0];
      const data = doc.data() as any;
      const producto: ProductoPOS = {
        id: doc.id,
        codigoBarras: data.codigoBarras,
        nombre: data.nombre,
        precioMinorista: data.precioMinorista,
        precioMayorista: data.precioMayorista
      };

      this.productoCache[codigo] = producto; // Cache
      this.agregarAlCarrito(producto);
    } else {
      // Activar búsqueda manual
      this.modoBusquedaManual = true;
    }
  }

  /** Agregar producto al carrito */
  agregarAlCarrito(producto: ProductoPOS) {
    const precioBase = this.tipoPrecio === 'minorista' 
      ? producto.precioMinorista 
      : producto.precioMayorista;

    const index = this.carrito.findIndex(item => item.productoId === producto.id);
    if (index >= 0) {
      this.carrito[index].cantidad++;
      this.carrito[index].subtotal = this.carrito[index].cantidad * this.carrito[index].precioUnitario;
    } else {
      this.carrito.push({
        productoId: producto.id,
        nombre: producto.nombre,
        cantidad: 1,
        precioUnitario: precioBase,
        subtotal: precioBase
      });
    }
    this.calcularTotal();
  }

  /** Editar cantidad */
  editarCantidad(index: number, nuevaCantidad: number) {
    if (nuevaCantidad < 1) return;
    this.carrito[index].cantidad = nuevaCantidad;
    this.carrito[index].subtotal = nuevaCantidad * this.carrito[index].precioUnitario;
    this.calcularTotal();
  }

  /** Editar precio */
  editarPrecio(index: number, nuevoPrecio: number) {
    if (nuevoPrecio < 0) return;
    this.carrito[index].precioUnitario = nuevoPrecio;
    this.carrito[index].subtotal = nuevoPrecio * this.carrito[index].cantidad;
    this.calcularTotal();
  }

  /** Eliminar producto */
  eliminarDelCarrito(index: number) {
    this.carrito.splice(index, 1);
    this.calcularTotal();
  }

  /** Calcular total general */
  calcularTotal() {
    this.total = this.carrito.reduce((sum, item) => sum + item.subtotal, 0);
  }

  /** Finalizar venta */
  async finalizarVenta() {
    if (this.carrito.length === 0) return;

    const venta = {
      fecha: new Date().toISOString(),
      tipoPrecio: this.tipoPrecio,
      cliente: this.clienteActual ? { dni: this.clienteActual.dni, nombre: this.clienteActual.nombre } : null,
      items: this.carrito,
      total: this.total
    };

    await addDoc(collection(this.firestore, 'Ventas'), venta);

    // Reset
    this.carrito = [];
    this.total = 0;
    this.clienteActual = null;
    this.tipoPrecio = 'minorista';
    this.productoCache = {};
  }
}
