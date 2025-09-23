import { Component, OnInit } from '@angular/core';
import { Firestore, collection, query, where, getDocs, addDoc, getDoc, updateDoc, doc } from '@angular/fire/firestore';
import Swal from 'sweetalert2';
import { ProductosCacheService } from '../../services/productos-cache.service';

interface ClientePOS {
  dni: string;
  nombre: string;
  tipo: 'minorista' | 'mayorista';
}

interface ProductoPOS {
  id: string;
  codigoBarras: string;
  descripcion: string;
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

  metodoPago: string | null = null;
  mostrarErrorPago = false;

  constructor(private firestore: Firestore, private productosCache: ProductosCacheService) { }

async ngOnInit() {
  await this.productosCache.syncProductos();
}

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

async procesarCodigoBarras(codigo: string) {
  const producto = await this.productosCache.getProductoPorCodigo(codigo);

  if (producto) {
    this.agregarAlCarrito(producto);
    this.modoBusquedaManual = false;
  } else {
    this.modoBusquedaManual = true;
    this.busquedaManual = '';
    this.productosFiltrados = [];
  }
}


  /** Agregar producto al carrito */
  agregarAlCarrito(producto: ProductoPOS, desdeBusquedaManual: boolean = false) {
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
        nombre: producto.descripcion,
        cantidad: 1,
        precioUnitario: precioBase,
        subtotal: precioBase
      });
    }
    this.calcularTotal();

    if (desdeBusquedaManual) {
      this.busquedaManual = '';
      this.productosFiltrados = [];
      this.modoBusquedaManual = false;
    }
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

  if (!this.metodoPago) {
    this.mostrarErrorPago = true;
    return;
  }

  this.mostrarErrorPago = false;

  if (!confirm("¿Desea confirmar la venta por $" + this.total.toFixed(2) + "?")) {
    return;
  }

  const venta = {
    fecha: new Date().toISOString(),
    tipoPrecio: this.tipoPrecio,
    cliente: this.clienteActual ? { dni: this.clienteActual.dni, nombre: this.clienteActual.nombre } : null,
    items: this.carrito,
    total: this.total,
    metodoPago: this.metodoPago
  };

  
  await addDoc(collection(this.firestore, 'Ventas'), venta);

    for (const item of venta.items) {
    const productoRef = doc(this.firestore, 'Productos', item.productoId);
    const productoSnap = await getDoc(productoRef);

    if (productoSnap.exists()) {
      const productoData = productoSnap.data();
      const stockActual = productoData['stock'] ?? 0; // por si no existe el campo
      const nuevoStock = stockActual - item.cantidad;

      await updateDoc(productoRef, { stock: nuevoStock >= 0 ? nuevoStock : 0 });
    }
  }

  // ✅ Mostrar popup éxito
  Swal.fire({
    title: '✅ Venta realizada',
    text: 'La venta fue registrada correctamente.',
    icon: 'success',
    showCancelButton: true,
    confirmButtonText: 'Ver comprobante',
    cancelButtonText: 'Cerrar'
  }).then((result) => {
    if (result.isConfirmed) {
      this.abrirComprobante(venta);
    }
  });

  // Reset
  this.carrito = [];
  this.total = 0;
  this.clienteActual = null;
  this.tipoPrecio = 'minorista';
  this.productoCache = {};
  this.metodoPago = null;
}



abrirComprobante(venta: any) {
  const win = window.open('', '_blank', 'width=800,height=600');
  if (!win) return;

  win.document.write(`
    <html>
      <head>
        <title>Comprobante de compra</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; }
          h2 { color: #2c3e50; }
          table { width: 100%; border-collapse: collapse; margin-top: 10px; }
          th, td { border: 1px solid #ccc; padding: 8px; text-align: left; }
          th { background: #f4f4f4; }
          .total { font-weight: bold; font-size: 18px; margin-top: 15px; }
        </style>
      </head>
      <body>
        <h2>🧾 Comprobante de compra</h2>
        <p><strong>Fecha:</strong> ${new Date(venta.fecha).toLocaleString()}</p>
        <p><strong>Método de pago:</strong> ${venta.metodoPago}</p>
        ${venta.cliente ? `<p><strong>Cliente:</strong> ${venta.cliente.nombre} (DNI: ${venta.cliente.dni})</p>` : ''}

        <table>
          <thead>
            <tr>
              <th>Producto</th>
              <th>Cant.</th>
              <th>Precio</th>
              <th>Subtotal</th>
            </tr>
          </thead>
          <tbody>
            ${venta.items.map((item: any) => `
              <tr>
                <td>${item.nombre}</td>
                <td>${item.cantidad}</td>
                <td>$${item.precioUnitario.toFixed(2)}</td>
                <td>$${item.subtotal.toFixed(2)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <p class="total">TOTAL: $${venta.total.toFixed(2)}</p>

        <script>window.print();</script>
      </body>
    </html>
  `);
  win.document.close();
}

async filtrarProductos() {
  if (this.busquedaManual.length > 2) {
    this.productosFiltrados = await this.productosCache.buscarProductos(this.busquedaManual);
  } else {
    this.productosFiltrados = [];
  }
}

}
