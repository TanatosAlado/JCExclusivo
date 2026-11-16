import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { take } from 'rxjs/operators';
import { CotizadorReparacionesService } from 'src/app/modules/admin/services/cotizador-reparaciones.service';
import { AuthService } from 'src/app/modules/auth/services/auth.service';
import { WhatsappService } from '../../services/whatsapp.service';
import { InfoEmpresaService } from '../../services/info-empresa.service';
import { AVISO_MANO_DE_OBRA, CotizacionReparacion, ModeloReparacion, PlantillaReparaciones, TipoPrecioReparacion, textoPesos } from '../../utils/cotizador-reparaciones';

/**
 * 🌐 "Cotizá tu reparación": el cliente elige su equipo, qué tiene roto y el repuesto, y ve el precio de los repuestos
 * (en pesos, con su lista de precios; solo los que hay en stock). La mano de obra se suma aparte.
 * Solo se ve si el admin lo habilitó (Gestiones → Cotizador de reparaciones). Los administradores la ven siempre (vista previa).
 */
@Component({
  selector: 'app-cotiza-reparacion',
  templateUrl: './cotiza-reparacion.component.html',
  styleUrls: ['./cotiza-reparacion.component.css']
})
export class CotizaReparacionComponent implements OnInit, OnDestroy {

  cargando = true;
  habilitado = false;
  esAdmin = false;
  modelos: ModeloReparacion[] = [];
  plantilla: PlantillaReparaciones | null = null;
  resultado: CotizacionReparacion | null = null;
  numeroWhatsapp: string | null = null;
  error = '';
  vuelta = 0;
  tipoPrecio: TipoPrecioReparacion = 'minorista';
  dolar: number | null = null;
  readonly textoPesos = textoPesos;
  readonly avisoManoDeObra = AVISO_MANO_DE_OBRA;
  private subs: Subscription[] = [];

  constructor(private cotizador: CotizadorReparacionesService, private auth: AuthService, private whatsapp: WhatsappService,
              private infoEmpresa: InfoEmpresaService) { }

  async ngOnInit() {
    this.subs.push(this.auth.getUsuarioActual().subscribe(c => {
      this.esAdmin = !!(c as any)?.administrador;
      this.tipoPrecio = (c as any)?.esMayorista ? 'mayorista' : 'minorista';   // mayoristas ven su lista
    }));
    this.subs.push(this.infoEmpresa.obtenerInfoGeneral().pipe(take(1)).subscribe((info: any) => this.dolar = Number(info?.dolar) || null));
    this.subs.push(this.whatsapp.obtenerNumeroWhatsapp().pipe(take(1)).subscribe(n => this.numeroWhatsapp = n));
    try {
      this.habilitado = await this.cotizador.publicoHabilitado();
      if (this.puedeVer) {
        const [plantilla, modelos] = await Promise.all([
          this.cotizador.plantilla(),
          this.esAdmin && !this.habilitado ? this.cotizador.modelos(true) : this.cotizador.modelosPublicos()
        ]);
        this.plantilla = plantilla;
        this.modelos = modelos;
      }
    } catch (e) {
      console.error('Error cargando el cotizador de reparaciones', e);
      this.error = 'No pudimos cargar el cotizador. Probá de nuevo en un rato.';
    } finally {
      this.cargando = false;
    }
  }

  ngOnDestroy(): void {
    this.subs.forEach(s => s.unsubscribe());
  }

  get puedeVer(): boolean {
    return this.habilitado || this.esAdmin;
  }

  alCotizar(r: CotizacionReparacion) {
    this.resultado = r;
    if (this.habilitado && !this.esAdmin) this.cotizador.registrarWeb(r);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  otra() {
    this.resultado = null;
    this.vuelta++;
  }

  get mensaje(): string {
    const r = this.resultado;
    if (!r) return '';
    return `Hola! Coticé una reparación en la web para mi ${r.modelo}:\n` +
      r.items.map(i => `• ${i.rubro} (${i.etiqueta}): ${textoPesos(i.precio)}`).join('\n') +
      (r.items.length > 1 ? `\nTotal repuestos: ${textoPesos(r.total)}` : '') +
      `\nQuiero hacer la reparación. ¿Cuánto es la mano de obra?`;
  }

  consultar() {
    if (!this.numeroWhatsapp || !this.resultado) return;
    this.whatsapp.abrirWhatsApp(String(this.numeroWhatsapp).replace(/\D/g, ''), this.mensaje);
  }
}
