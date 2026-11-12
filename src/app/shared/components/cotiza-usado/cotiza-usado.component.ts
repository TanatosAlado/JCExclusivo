import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { take } from 'rxjs/operators';
import { TasadorService } from 'src/app/modules/admin/services/tasador.service';
import { AuthService } from 'src/app/modules/auth/services/auth.service';
import { WhatsappService } from '../../services/whatsapp.service';
import { ModeloTasador, ResultadoTasacion, textoUSD } from '../../utils/tasador';

/**
 * 🌐 "Cotizá tu usado": el cliente responde las preguntas del tasador y ve cuánto le tomamos el equipo.
 * Solo se ve si el admin lo habilitó (Gestiones → Tasador). Los administradores la pueden ver siempre (vista previa).
 */
@Component({
  selector: 'app-cotiza-usado',
  templateUrl: './cotiza-usado.component.html',
  styleUrls: ['./cotiza-usado.component.css']
})
export class CotizaUsadoComponent implements OnInit, OnDestroy {

  cargando = true;
  habilitado = false;
  esAdmin = false;
  modelos: ModeloTasador[] = [];
  resultado: ResultadoTasacion | null = null;
  numeroWhatsapp: string | null = null;
  error = '';
  /** Se reinicia el componente de preguntas para "Cotizar otro" */
  vuelta = 0;
  readonly textoUSD = textoUSD;
  private subs: Subscription[] = [];

  constructor(private tasador: TasadorService, private auth: AuthService, private whatsapp: WhatsappService) { }

  async ngOnInit() {
    this.subs.push(this.auth.getUsuarioActual().subscribe(c => this.esAdmin = !!(c as any)?.administrador));
    this.subs.push(this.whatsapp.obtenerNumeroWhatsapp().pipe(take(1)).subscribe(n => this.numeroWhatsapp = n));
    try {
      this.habilitado = await this.tasador.publicoHabilitado();
      if (this.puedeVer) {
        this.modelos = this.esAdmin && !this.habilitado ? await this.tasador.modelos(true) : await this.tasador.modelosPublicos();
      }
    } catch (e) {
      console.error('Error cargando el cotizador', e);
      this.error = 'No pudimos cargar el cotizador. Probá de nuevo en un rato.';
    } finally {
      this.cargando = false;
    }
  }

  ngOnDestroy(): void {
    this.subs.forEach(s => s.unsubscribe());
  }

  /** Clientes: solo si está habilitado. Administradores: siempre (vista previa). */
  get puedeVer(): boolean {
    return this.habilitado || this.esAdmin;
  }

  alCotizar(r: ResultadoTasacion) {
    this.resultado = r;
    if (this.habilitado && !this.esAdmin) this.tasador.registrarWeb(r);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  otra() {
    this.resultado = null;
    this.vuelta++;
  }

  /** Mensaje para WhatsApp con el resumen de la cotización */
  get mensaje(): string {
    const r = this.resultado;
    if (!r) return '';
    const malas = r.respuestas.filter(x => x.descuento > 0).map(x => `• ${x.pregunta} ${x.respuesta === 'si' ? 'Sí' : 'No'}`);
    return `Hola! Coticé mi equipo en la web: ${r.modelo} ${r.capacidad}. Me dio ${textoUSD(r.totalUSD)}.` +
      (malas.length ? `\n${malas.join('\n')}` : '\nEstá en perfectas condiciones.') +
      `\nQuiero usarlo en plan canje.`;
  }

  consultar() {
    if (!this.numeroWhatsapp || !this.resultado) return;
    this.whatsapp.abrirWhatsApp(String(this.numeroWhatsapp).replace(/\D/g, ''), this.mensaje);
  }
}
