import { Component, OnInit, OnDestroy } from '@angular/core';
import { Firestore, collection, query, where, getDocs, addDoc, getDoc, updateDoc, doc } from '@angular/fire/firestore';
import Swal from 'sweetalert2';
import { ProductosCacheService } from '../../services/productos-cache.service';
import { CajaService } from '../../services/caja.service';
import { AbrirCajaDialogComponent } from '../abrir-caja-dialog/abrir-caja-dialog.component';
import { MatDialog } from '@angular/material/dialog';
import { SucursalesService } from 'src/app/modules/admin/services/sucursales.service'; 
import { firstValueFrom, Subscription } from 'rxjs';
import { Sucursal } from 'src/app/modules/admin/models/sucursal.model';
import { FormControl } from '@angular/forms';
import { VouchersPuntosService } from 'src/app/shared/services/vouchers-puntos.service';
import { GeneralService } from 'src/app/shared/services/general.service';
import { InfoEmpresa } from 'src/app/shared/models/infoEmpresa.model';
import { InfoEmpresaService } from 'src/app/shared/services/info-empresa.service';

interface ClientePOS {
  dni: string;
  nombre: string;
  tipo: 'minorista' | 'mayorista';
  puntos: number;
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
export class LayoutDespachoComponent implements OnInit, OnDestroy {

  // Sucursales
  sucursales: Sucursal[] = [];
  private sucursalesSub?: Subscription;

  // Sucursal / caja seleccionada
  selectedSucursal: Sucursal | null = null;
  cajaActiva: any = null;

  // Array de productos para búsqueda manual
  productosFiltrados: ProductoPOS[] = [];

  // Cliente
  clienteActual: ClientePOS | null = null;
  tipoPrecio: 'minorista' | 'mayorista' = 'minorista';
  buscandoCliente = false;
  busquedaRealizada = false;

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

  loadingInicial = false;

  cuponControl = new FormControl('');
  cuponAplicado: any = null;
  mensajeCupon: string = '';
  errorCupon: string = '';
  cuponInvalido: boolean = false;

  usarPuntos: boolean = false;
  puntosAplicados: number = 0;
  valorMonetarioPorPunto: number = 50;
  valorParaSumarPunto: number = 200;
  montoParaActivar: number = 50000; // Monto mínimo para activar el modo mayorista

  constructor(
    private firestore: Firestore,
    private productosCache: ProductosCacheService,
    private cajaService: CajaService,
    private dialog: MatDialog,
    private sucursalesService: SucursalesService,
    private puntosService: VouchersPuntosService,
    public generalService: GeneralService
  ) { }


async ngOnInit() {
  this.loadingInicial = true;
  try {
    // 1) sincronizo cache de productos
    await this.productosCache.syncProductos();

    // 2) traigo las sucursales UNA VEZ (sin suscripción continua)
    const lista = await firstValueFrom(this.sucursalesService.obtenerSucursales());
    this.sucursales = lista || [];

    console.log('Productos sincronizados y sucursales cargadas:', this.sucursales);
  } catch (err) {
    console.error('Error inicializando POS:', err);
    Swal.fire('Error', 'No se pudieron cargar los datos iniciales. ' + (err as any)?.message, 'error');
  } finally {
    this.loadingInicial = false;
  }
    await this.inicializarValoresPuntos();
    this.cuponControl.valueChanges.subscribe(() => {
      if (this.cuponInvalido) {
        this.cuponInvalido = false;
        this.mensajeCupon = '';
      }
    });
}

  async inicializarValoresPuntos() {
    const valores = await this.puntosService.obtenerValoresPuntos();
    if (valores) {
      this.valorParaSumarPunto = valores.valorParaSumarPunto;
      this.valorMonetarioPorPunto = valores.valorMonetarioPorPunto;
    }
    
    this.puntosAplicados = this.getPuntosAplicados(this.carrito);

    const valoresMayoristas = await this.puntosService.obtenerMontosMayoristas();
    if (valoresMayoristas) {
      this.montoParaActivar = valoresMayoristas.minimoPrimeraCompra;
    } 

  }

    getPuntosAplicados(carrito: any): number {
    const total = carrito.reduce(
      (sum: number, prod: any) => sum + (prod.precioUnitario * prod.cantidad),
      0
    );

    const maxPuntosPorMonto = Math.floor(total / this.valorMonetarioPorPunto);
    if(this.clienteActual?.puntos){
      return Math.min(this.clienteActual.puntos, maxPuntosPorMonto);  
    }
    else{
      return 0;  
    }
  }

  ngOnDestroy() {
    
  }


    aplicarCupon() {
    const codigo = this.cuponControl.value?.trim();
    if (!codigo) return;

    this.puntosService.obtenerCuponPorCodigo(codigo).then((cupon) => {
      if (cupon) {
        this.cuponAplicado = cupon;
        this.cuponInvalido = false;
        this.mensajeCupon = '';
        this.cuponControl.disable(); // Deshabilitamos si es válido
      } else {
        this.cuponAplicado = null;
        this.cuponInvalido = true;
        this.mensajeCupon = 'Cupón inválido o no disponible ❌';
      }
    });
  }

  eliminarCupon() {
    this.cuponAplicado = null;
    this.errorCupon = '';
    this.cuponControl.enable();
    this.cuponControl.setValue('');
  }


  /** ---------------------
   * Selección de sucursal
   * --------------------- */
async seleccionarSucursal(sucursal: Sucursal) {
  console.log('sucursal:', sucursal)
  // Mostrar un estado de carga si querés (opcional)
  // this.loadingSeleccion = true;

  try {
    // 1) consulto Firestore por una caja abierta HOY para esa sucursal
    const cajaFirestore = await this.cajaService.verificarCajaAbierta(sucursal.id);
    if (cajaFirestore) {
      // sólo ahora seteamos la sucursal seleccionada y guardamos preferencia
      this.selectedSucursal = sucursal;
      this.cajaActiva = cajaFirestore;
      localStorage.setItem('sucursalSeleccionada', sucursal.id);
      return;
    }
  } catch (err) {
    console.warn('Error verificando caja en Firestore:', err);
    // seguimos al fallback
  }

  // 2) fallback local (sólo si la caja local es válida y corresponde a la misma sucursal)
  const cajaLocal = (typeof this.cajaService.getCajaActivaLocalValidada === 'function')
    ? this.cajaService.getCajaActivaLocalValidada()
    : (this.cajaService.getCajaActiva ? this.cajaService.getCajaActiva() : null);

  if (cajaLocal && cajaLocal.sucursalId === sucursal.id) {
    // la caja local es válida (de hoy) -> aceptamos selección
    this.selectedSucursal = sucursal;
    this.cajaActiva = cajaLocal;
    localStorage.setItem('sucursalSeleccionada', sucursal.id);
    return;
  }

  // 3) No hay caja válida: forzamos apertura de caja antes de permitir facturar
  const result = await Swal.fire({
    title: '🚨 Caja no abierta',
    text: 'Debes abrir la caja para esta sucursal antes de registrar ventas.',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Abrir caja',
    cancelButtonText: 'Cancelar'
  });

  if (result.isConfirmed) {
    // abrirCaja abrirá el diálogo y si la apertura es exitosa pondrá la caja en localStorage
    this.abrirCaja(sucursal.id);
  } else {
    // si cancela, no seleccionamos nada (seguimos mostrando cards)
    this.selectedSucursal = null;
    this.cajaActiva = null;
    // y no tocamos localStorage.sucursalSeleccionada
  }

}


  /** Abrir caja: abre el diálogo y luego sincroniza la caja recién creada */
abrirCaja(sucursalIdExistente?: string) {
  const dialogRef = this.dialog.open(AbrirCajaDialogComponent, {
    width: '400px',
    data: { sucursalId: sucursalIdExistente }
  });

  dialogRef.afterClosed().subscribe(async result => {
    if (result) {
      try {
        const usuarioId = 'usuario123'; // ideal: traer desde AuthService

        // Crear caja en Firestore (guarda fecha como Timestamp dentro del service)
        const nuevaCaja = await this.cajaService.abrirCaja(result.sucursalId, usuarioId, result.montoInicial);

        // Guardamos la sucursal seleccionada SÓLO si la apertura tuvo éxito
        localStorage.setItem('sucursalSeleccionada', result.sucursalId);

        // sincronizamos la cajaActiva en memoria para el componente
        // si tu servicio ya dejó la caja en localStorage, la podemos leer:
        const cajaVal = (typeof this.cajaService.getCajaActivaLocalValidada === 'function')
          ? this.cajaService.getCajaActivaLocalValidada()
          : this.cajaService.getCajaActiva && this.cajaService.getCajaActiva();

        this.cajaActiva = cajaVal || nuevaCaja;
        // y setear la sucursal seleccionada en UI
        const suc = this.sucursales.find(x => x.id === result.sucursalId);
        if (suc) this.selectedSucursal = suc;

        Swal.fire('✅ Caja abierta correctamente', '', 'success');
      } catch (err: any) {
        Swal.fire('⚠️ Error', err?.message || 'Error al abrir caja', 'error');
      }
    } else {
      // usuario canceló el diálogo: no hacemos nada (no guardamos sucursal)
    }
  });
}


  /** Volver a elegir sucursal (cancela selección actual) */
  cambiarSucursal() {
    this.selectedSucursal = null;
    this.cajaActiva = null;
    localStorage.removeItem('sucursalSeleccionada');
    this.cajaService.clearCajaActiva();
  }

  /** Buscar cliente por DNI */
  async buscarClientePorDNI(dni: string) {
  if (!dni.trim()) return;

  this.buscandoCliente = true;
  this.busquedaRealizada = false;
  this.clienteActual = null;

  try {
    const dniCliente = parseInt(dni, 10);
    const clientesRef = collection(this.firestore, 'Clientes');
    const q = query(clientesRef, where('dni', '==', dniCliente));
    const snap = await getDocs(q);

    if (!snap.empty) {
      const docu = snap.docs[0];
      const data = docu.data() as any;

      this.clienteActual = {
        dni: data.dni,
        nombre: data.nombre,
        tipo: data.tipoCliente || 'minorista',
        puntos: data.puntos || 0
      };

      this.tipoPrecio = this.clienteActual.tipo;
    } else {
      this.clienteActual = null;
      this.tipoPrecio = 'minorista';
    }
  } catch (error) {
    console.error('Error buscando cliente:', error);
  } finally {
    this.buscandoCliente = false;
    this.busquedaRealizada = true;
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

  editarCantidad(index: number, nuevaCantidad: number) {
    if (nuevaCantidad < 1) return;
    this.carrito[index].cantidad = nuevaCantidad;
    this.carrito[index].subtotal = nuevaCantidad * this.carrito[index].precioUnitario;
    this.calcularTotal();
  }

  editarPrecio(index: number, nuevoPrecio: number) {
    if (nuevoPrecio < 0) return;
    this.carrito[index].precioUnitario = nuevoPrecio;
    this.carrito[index].subtotal = nuevoPrecio * this.carrito[index].cantidad;
    this.calcularTotal();
  }

  eliminarDelCarrito(index: number) {
    this.carrito.splice(index, 1);
    this.calcularTotal();
  }

  calcularTotal() {
    this.total = this.carrito.reduce((sum, item) => sum + item.subtotal, 0);
    this.puntosAplicados = this.getPuntosAplicados(this.carrito);
  }

  async finalizarVenta() {
    if (this.carrito.length === 0) return;

    if (!this.metodoPago) {
      this.mostrarErrorPago = true;
      return;
    }

    this.mostrarErrorPago = false;

    // preferimos cajaActiva en memoria, si no existe usamos lo de service (localStorage)
    const cajaActiva = this.cajaActiva || this.cajaService.getCajaActiva();
    if (!cajaActiva) {
      Swal.fire('❌ No hay caja abierta', 'Debes abrir caja antes de vender.', 'error');
      return;
    }

    if (!confirm("¿Desea confirmar la venta por $" + this.total.toFixed(2) + "?")) {
      return;
    }

    const venta = {
      fecha: new Date().toISOString(),
      tipoPrecio: this.tipoPrecio,
      cliente: this.clienteActual ? { dni: this.clienteActual.dni, nombre: this.clienteActual.nombre } : null,
      items: this.carrito,
      total: this.total,
      metodoPago: this.metodoPago,
      sucursalId: cajaActiva.sucursalId,
      cajaId: cajaActiva.id
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
