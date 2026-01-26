import { Component, Input, OnInit } from '@angular/core';
import { Producto } from '../../models/producto.model';
import { AuthService } from 'src/app/modules/auth/services/auth.service';
import { Router } from '@angular/router';
import { LoginComponent } from 'src/app/modules/auth/views/login/login.component';
import { Cliente } from 'src/app/modules/auth/models/cliente.model';
import { GeneralService } from 'src/app/shared/services/general.service';
import { ToastService } from 'src/app/shared/services/toast.service';
import { MatDialog } from '@angular/material/dialog';

@Component({
  selector: 'app-item',
  templateUrl: './item.component.html',
  styleUrls: ['./item.component.css']
})
export class ItemComponent implements OnInit {

  @Input() producto!: Producto;
  @Input() esMayorista: boolean = false;

  selectedVariante: any = null;
  varianteSeleccionada: number | null = null;
  loadingCarrito: { [id: string]: boolean } = {};

  modelosUnicos: string[] = [];
  modeloSeleccionado: string | null = null;
  coloresFiltrados: any[] = [];

  constructor(
    private authService: AuthService,
    private router: Router,
    private generalService: GeneralService,
    private toastService: ToastService,
    private dialog: MatDialog,
  ) {}

  ngOnInit(): void {
    // detectar si el cliente es mayorista
    this.authService.getUsuarioActual().subscribe(cliente => {
      this.esMayorista = cliente?.esMayorista ?? false;
    });

    // seguridad: si no hay producto, salimos
    if (!this.producto) return;

    // Si el producto tiene variantes...
    if (Array.isArray(this.producto.variantes) && this.producto.variantes.length > 0) {
      // Creá una función de normalización para evitar problemas de mayúsculas/espacios
      const normalize = (s: any) => (typeof s === 'string' ? s.trim().toLowerCase() : '');

      // obtener modelos únicos normalizados pero mostrar la versión "amigable"
      const modelosMap = new Map<string, string>(); // key = normalized, value = first original
      this.producto.variantes.forEach(v => {
        const raw = v?.modelo ?? '';
        const key = normalize(raw);
        if (key && !modelosMap.has(key)) {
          modelosMap.set(key, raw.trim());
        }
      });
      this.modelosUnicos = Array.from(modelosMap.values());

      // Si el producto es solo variantes por color (sin modelos), mostramos colores ya
      if (this.producto.tipoVariantes === 'color') {
        this.coloresFiltrados = this.producto.variantes.slice();
      }

      // Si queremos preseleccionar la primera variante disponible:
      if (this.coloresFiltrados.length === 0 && this.producto.tipoVariantes !== 'modelo+color') {
        this.selectedVariante = this.producto.variantes[0];
        this.varianteSeleccionada = 0;
      }
    }
  }

  // Cuando elegimos un modelo (pasamos la etiqueta tal como la mostramos)
  seleccionarModelo(modeloLabel: string) {
    this.modeloSeleccionado = modeloLabel;
    const normalize = (s: any) => (typeof s === 'string' ? s.trim().toLowerCase() : '');
    const key = normalize(modeloLabel);

    // Filtramos variantes cuyo modelo normalizado coincida
    this.coloresFiltrados = (this.producto.variantes || []).filter(v => normalize(v?.modelo) === key);

    console.log('Seleccionado modelo:', modeloLabel, '-> coloresFiltrados:', this.coloresFiltrados);

    // limpiar selección previa de variante
    this.selectedVariante = null;
    this.varianteSeleccionada = null;
  }

  // Acepta tanto índice (number) como objeto variante
  seleccionarVariante(arg: number | any) {
    if (typeof arg === 'number') {
      const idx = arg as number;
      this.selectedVariante = this.producto.variantes?.[idx] ?? null;
      this.varianteSeleccionada = idx;
    } else {
      // arg es la variante misma
      this.selectedVariante = arg;
      this.varianteSeleccionada = this.producto.variantes?.indexOf(arg) ?? null;
    }
    console.log('Variante seleccionada:', this.selectedVariante);
  }

  // Suma stock (busca propiedad 'cantidad' o 'stock' por compatibilidad)
  getStockTotal(item: any): number {
    if (!item) return 0;
    const arr = Array.isArray(item.stockSucursales) ? item.stockSucursales : [];
    return arr.reduce((sum: number, s: any) => {
      // soporte para 'cantidad' o 'stock'
      const c = (s && (s.cantidad ?? s.stock)) || 0;
      return sum + Number(c);
    }, 0);
  }

  // Agregar al carrito (igual que ya tenías)
  agregarCarrito(producto: Producto) {
    if (producto.tipoVariantes && producto.tipoVariantes !== 'none') {
      console.warn('Intento de agregar al carrito un producto con variantes. Redirigir a detalle en su lugar.');
      // opcional: podés mostrar un toast informando al usuario
      return;
    }
    const cliente = this.generalService.getClienteActual();
    this.loadingCarrito[producto.id] = true;
    const finalizar = () => this.loadingCarrito[producto.id] = false;

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
          this.procesarProductoEnCarrito(clienteLogueado, producto, finalizar);
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

    this.procesarProductoEnCarrito(cliente, producto, finalizar);
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

  verDetalle(producto: Producto) {
    console.log('Navegando a detalle de producto:', producto);
    this.router.navigate(['/producto', producto.id]);
  }
}
