import { Component, ElementRef, HostListener, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { permisosDe } from 'src/app/core/secciones';
import { GeneralService } from '../../services/general.service';
import { AvisosAdminService } from '../../services/avisos-admin.service';
import { AvisoAdmin, MAX_AVISOS_LISTA, haceCuanto } from '../../utils/avisos-admin';

/**
 * 🔔 Campanita de avisos en la barra (solo administradores con permiso de Pedidos).
 * Muestra cuántos pedidos web (y solicitudes mayoristas, si tiene permiso de Clientes) están pendientes,
 * y un aviso flotante cuando entra uno nuevo con la página abierta. Sin sonido.
 */
@Component({
  selector: 'app-campana-avisos',
  templateUrl: './campana-avisos.component.html',
  styleUrls: ['./campana-avisos.component.css']
})
export class CampanaAvisosComponent implements OnInit, OnDestroy {

  visible = false;
  abierta = false;
  avisos: AvisoAdmin[] = [];
  flotantes: AvisoAdmin[] = [];
  readonly haceCuanto = haceCuanto;
  private subs: Subscription[] = [];
  private timers: any[] = [];

  constructor(private general: GeneralService, private avisosService: AvisosAdminService, private router: Router, private el: ElementRef) { }

  ngOnInit(): void {
    this.subs.push(this.general.getCliente().subscribe((cliente: any) => {
      const permisos = permisosDe(cliente);
      const pedidos = permisos.includes('pedidos');
      this.visible = pedidos;
      if (pedidos) this.avisosService.iniciar({ pedidos: true, mayoristas: permisos.includes('clientes') });
      else { this.avisosService.detener(); this.abierta = false; }
    }));
    this.subs.push(this.avisosService.avisos$.subscribe(l => this.avisos = l));
    this.subs.push(this.avisosService.nuevo$.subscribe(a => this.mostrarFlotante(a)));
  }

  ngOnDestroy(): void {
    this.subs.forEach(s => s.unsubscribe());
    this.timers.forEach(t => clearTimeout(t));
  }

  get cantidad(): number {
    return this.avisos.length;
  }

  get lista(): AvisoAdmin[] {
    return this.avisos.slice(0, MAX_AVISOS_LISTA);
  }

  get cantidadPedidos(): number {
    return this.avisos.filter(a => a.tipo === 'pedido').length;
  }

  trackAviso(_: number, a: AvisoAdmin) {
    return a.id;
  }

  alternar(ev?: Event) {
    ev?.stopPropagation();
    this.abierta = !this.abierta;
  }

  ir(a: AvisoAdmin | null, ruta = '/gestiones/pedidos') {
    this.abierta = false;
    if (a) this.flotantes = this.flotantes.filter(x => x.id !== a.id);
    this.router.navigate([a?.ruta || ruta]);
  }

  cerrarFlotante(a: AvisoAdmin, ev?: Event) {
    ev?.stopPropagation();
    this.flotantes = this.flotantes.filter(x => x.id !== a.id);
  }

  private mostrarFlotante(a: AvisoAdmin) {
    if (!this.visible) return;
    this.flotantes = [...this.flotantes.filter(x => x.id !== a.id), a].slice(-3);
    this.timers.push(setTimeout(() => this.flotantes = this.flotantes.filter(x => x.id !== a.id), 10000));
  }

  /** Cierra la lista al tocar afuera o con Escape */
  @HostListener('document:click', ['$event'])
  alTocarAfuera(ev: Event) {
    if (this.abierta && !this.el.nativeElement.contains(ev.target)) this.abierta = false;
  }

  @HostListener('document:keydown.escape')
  alEscape() {
    this.abierta = false;
  }
}
