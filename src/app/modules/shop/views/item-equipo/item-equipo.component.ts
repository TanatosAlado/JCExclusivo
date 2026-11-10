import { Component, HostListener, Input, OnDestroy, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Subscription } from 'rxjs';
import { LoginComponent } from 'src/app/modules/auth/views/login/login.component';
import { Cliente } from 'src/app/modules/auth/models/cliente.model';
import { GeneralService } from 'src/app/shared/services/general.service';
import { ToastService } from 'src/app/shared/services/toast.service';
import { InfoEmpresaService } from 'src/app/shared/services/info-empresa.service';
import { precioEquipoEnPesos, precioListaEquipo, PREFIJO_UID_EQUIPO, cotizacionEquipos, esNuevo } from 'src/app/shared/utils/equipos-tienda';
import { fotosDe } from 'src/app/modules/admin/services/equipos.service';
import { AnalyticsService } from 'src/app/shared/services/analytics.service';
import { itemAnalytics } from 'src/app/shared/utils/analytics-tienda';

/**
 * Cómo se muestra el precio de los equipos en la tienda.
 *  true  → el precio principal es en DÓLARES (US$), sin el equivalente en pesos.
 *  false → el precio principal es en pesos y debajo el valor en US$.
 * (Los equipos cargados en pesos se muestran siempre en pesos.)
 */
export const PRECIO_EQUIPOS_EN_DOLARES = true;

/**
 * Tarjeta de un EQUIPO en la tienda (unidad única).
 * Muestra sus datos (color, capacidad, grado, batería, observaciones) y el precio según el cliente.
 */
@Component({
  selector: 'app-item-equipo',
  templateUrl: './item-equipo.component.html',
  styleUrls: ['./item-equipo.component.css']
})
export class ItemEquipoComponent implements OnInit, OnDestroy {

  @Input() equipo: any;
  @Input() esMayorista = false;

  dolar = 0;
  agregando = false;
  readonly enDolares = PRECIO_EQUIPOS_EN_DOLARES;
  private subs: Subscription[] = [];

  constructor(
    private analytics: AnalyticsService,
    private generalService: GeneralService,
    private toastService: ToastService,
    private dialog: MatDialog,
    private infoEmpresaService: InfoEmpresaService
  ) { }

  ngOnInit(): void {
    this.subs.push(this.infoEmpresaService.obtenerInfoGeneral().subscribe(info => this.dolar = cotizacionEquipos(info)));   // dólar JC
  }

  ngOnDestroy(): void {
    if (this.mostrarGaleria) document.body.style.removeProperty('overflow');
    this.subs.forEach(s => s.unsubscribe());
  }

  get precioPesos(): number {
    return precioEquipoEnPesos(this.equipo, this.esMayorista, this.dolar);
  }

  get precioDolares(): number | null {
    return this.equipo?.moneda === 'USD' ? precioListaEquipo(this.equipo, this.esMayorista) : null;
  }

  get enCarrito(): boolean {
    const cliente = this.generalService.getClienteActual();
    const uid = PREFIJO_UID_EQUIPO + this.equipo?.id;
    const carrito = cliente?.id === 'invitado'
      ? (() => { try { return JSON.parse(localStorage.getItem('carritoInvitado') || '[]'); } catch { return []; } })()
      : (cliente?.carrito || []);
    return carrito.some((i: any) => i.uidCarrito === uid);
  }

  /**
   * "US$ 1.250" (con el formato argentino del navegador).
   * No se usa el pipe "number" con 'es-AR' porque la app no tiene registrados los datos de ese idioma.
   */
  usd(valor: number | null, decimales = 0): string {
    const n = Number(valor) || 0;
    return 'US$ ' + new Intl.NumberFormat('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: decimales }).format(n);
  }

  // =====================================================
  // FOTOS (varias: se pasan con flechas; tocando la foto se ve grande)
  // =====================================================

  readonly sinFoto = '../../../../../assets/imagenes/No disponible.png';
  indiceFoto = 0;
  mostrarGaleria = false;

  get fotos(): string[] {
    return fotosDe(this.equipo);
  }

  get fotoActual(): string {
    return this.fotos[this.indiceFoto] || this.fotos[0] || this.sinFoto;
  }

  cambiarFoto(dir: number, evento?: Event) {
    evento?.stopPropagation();
    const n = this.fotos.length;
    if (n < 2) return;
    this.indiceFoto = (this.indiceFoto + dir + n) % n;
  }

  irAFoto(i: number, evento?: Event) {
    evento?.stopPropagation();
    this.indiceFoto = i;
  }

  abrirGaleria() {
    if (!this.fotos.length) return;
    this.mostrarGaleria = true;
    this.analytics.verProducto(itemAnalytics(this.equipo, this.precioPesos, 1));
    document.body.style.overflow = 'hidden';
  }

  cerrarGaleria() {
    this.mostrarGaleria = false;
    document.body.style.removeProperty('overflow');
  }

  @HostListener('document:keydown', ['$event'])
  teclado(e: KeyboardEvent) {
    if (!this.mostrarGaleria) return;
    if (e.key === 'Escape') this.cerrarGaleria();
    else if (e.key === 'ArrowRight') this.cambiarFoto(1);
    else if (e.key === 'ArrowLeft') this.cambiarFoto(-1);
  }

  /** Nuevo o usado (bien visible en la tarjeta) */
  get nuevo(): boolean {
    return esNuevo(this.equipo);
  }

  claseBateria(): string {
    const b = Number(this.equipo?.bateria) || 0;
    return b >= 90 ? 'bien' : b >= 80 ? 'media' : 'baja';
  }

  agregarCarrito() {
    if (this.agregando || this.enCarrito) return;
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
          this.agregar();
        } else {
          this.toastService.toastMessage('Debes iniciar sesión o continuar como invitado para agregar productos al carrito.', 'orange', 3000);
        }
      });
      return;
    }
    this.agregar();
  }

  private agregar() {
    this.agregando = true;
    this.generalService.cargarEquipoCarrito(this.equipo)
      .then(() => {
        this.toastService.toastMessage('Equipo agregado al carrito', 'green', 2000);
        this.analytics.agregarAlCarrito(itemAnalytics(this.equipo, this.precioPesos, 1));
      })
      .catch(err => {
        if (err?.tipo === 'YA_EN_CARRITO') {
          this.toastService.toastMessage('Este equipo ya está en tu carrito.', 'orange', 2500);
          return;
        }
        console.error('Error al agregar equipo:', err);
        this.toastService.toastMessage('No se pudo agregar el equipo al carrito. Intentá nuevamente.', 'red', 3000);
      })
      .finally(() => this.agregando = false);
  }
}
