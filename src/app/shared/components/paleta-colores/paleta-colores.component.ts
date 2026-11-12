import { Component, OnDestroy, OnInit } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { AuthService } from 'src/app/modules/auth/services/auth.service';
import {
  COLOR_FONDO_ORIGINAL, COLOR_PRIMARIO_ORIGINAL, PALETA_COLORES_ACTIVA, PaletaColores, SUGERIDOS_FONDO, SUGERIDOS_PRIMARIO,
  aplicarPaleta, blancoSeLee, guardarPaleta, leerPaleta, normalizarHex
} from '../../utils/paleta-colores';

/**
 * 🎨 Botón flotante con una paleta para probar el color del sitio (solo administradores, solo en la tienda).
 * Lo elegido queda en este navegador; los clientes no ven ningún cambio.
 */
@Component({
  selector: 'app-paleta-colores',
  templateUrl: './paleta-colores.component.html',
  styleUrls: ['./paleta-colores.component.css']
})
export class PaletaColoresComponent implements OnInit, OnDestroy {

  esAdmin = false;
  enTienda = true;
  abierta = false;
  paleta: PaletaColores = { primario: COLOR_PRIMARIO_ORIGINAL, fondo: COLOR_FONDO_ORIGINAL };
  copiado = false;
  readonly activa = PALETA_COLORES_ACTIVA;
  readonly sugeridosPrimario = SUGERIDOS_PRIMARIO;
  readonly sugeridosFondo = SUGERIDOS_FONDO;
  private subs: Subscription[] = [];

  constructor(private auth: AuthService, private router: Router) { }

  ngOnInit(): void {
    this.paleta = leerPaleta() || { primario: COLOR_PRIMARIO_ORIGINAL, fondo: COLOR_FONDO_ORIGINAL };
    this.subs.push(this.auth.getUsuarioActual().subscribe(c => {
      this.esAdmin = !!(c as any)?.administrador;
      // Si no es admin, se ve el sitio original (por si quedó algo guardado en este navegador)
      aplicarPaleta(this.esAdmin && this.activa ? leerPaleta() : null);
    }));
    this.revisarRuta(this.router.url);
    this.subs.push(this.router.events.pipe(filter(e => e instanceof NavigationEnd))
      .subscribe(e => this.revisarRuta((e as NavigationEnd).urlAfterRedirects)));
  }

  ngOnDestroy(): void {
    this.subs.forEach(s => s.unsubscribe());
  }

  /** Solo en la tienda: no en Gestiones ni en Despacho */
  private revisarRuta(url: string) {
    this.enTienda = !/^\/(gestiones|despacho)/.test(url || '');
    if (!this.enTienda) this.abierta = false;
  }

  get visible(): boolean {
    return this.activa && this.esAdmin && this.enTienda;
  }

  get cambiada(): boolean {
    return this.paleta.primario !== COLOR_PRIMARIO_ORIGINAL || this.paleta.fondo !== COLOR_FONDO_ORIGINAL;
  }

  get avisoContraste(): boolean {
    return !blancoSeLee(this.paleta.primario);
  }

  elegirPrimario(c: string) {
    const h = normalizarHex(c);
    if (!h) return;
    this.paleta = { ...this.paleta, primario: h };
    this.aplicar();
  }

  elegirFondo(c: string) {
    const h = normalizarHex(c);
    if (!h) return;
    this.paleta = { ...this.paleta, fondo: h };
    this.aplicar();
  }

  private aplicar() {
    this.copiado = false;
    aplicarPaleta(this.paleta);
    guardarPaleta(this.cambiada ? this.paleta : null);
  }

  restablecer() {
    this.paleta = { primario: COLOR_PRIMARIO_ORIGINAL, fondo: COLOR_FONDO_ORIGINAL };
    this.aplicar();
  }

  get texto(): string {
    return `Color principal ${this.paleta.primario} · Fondo ${this.paleta.fondo}`;
  }

  async copiar() {
    try {
      await navigator.clipboard.writeText(this.texto);
      this.copiado = true;
    } catch {
      this.copiado = false;
    }
  }
}
