import { Component, OnInit } from '@angular/core';
import Swal from 'sweetalert2';
import {
  ClienteConSolicitud, SolicitudesMayoristasService, SolicitudMayoristaError
} from '../../services/solicitudes-mayoristas.service';
import { cuitValido, formatearCuit, MAX_MOTIVO_RECHAZO } from 'src/app/shared/utils/solicitud-mayorista';

/**
 * Gestiones → Solicitudes mayoristas.
 * Los clientes que piden ser mayoristas (al registrarse o desde "Mi cuenta") quedan acá
 * hasta que un administrador con permiso de Clientes los aprueba o rechaza.
 */
@Component({
  selector: 'app-solicitudes-mayoristas',
  templateUrl: './solicitudes-mayoristas.component.html',
  styleUrls: ['./solicitudes-mayoristas.component.css']
})
export class SolicitudesMayoristasComponent implements OnInit {

  vista: 'pendientes' | 'resueltas' = 'pendientes';
  pendientes: ClienteConSolicitud[] = [];
  resueltas: ClienteConSolicitud[] | null = null;
  cargando = false;
  error = '';
  /** id del cliente que se está aprobando / rechazando */
  procesando: string | null = null;

  readonly formatearCuit = formatearCuit;
  readonly cuitValido = cuitValido;

  constructor(private solicitudes: SolicitudesMayoristasService) { }

  ngOnInit(): void {
    this.cargar();
  }

  async cargar() {
    this.cargando = true;
    this.error = '';
    try {
      this.pendientes = await this.solicitudes.pendientes();
      if (this.vista === 'resueltas') this.resueltas = await this.solicitudes.resueltas();
    } catch (err) {
      console.error(err);
      this.error = 'No se pudieron cargar las solicitudes. Probá de nuevo.';
    } finally {
      this.cargando = false;
    }
  }

  async verResueltas() {
    this.vista = 'resueltas';
    if (this.resueltas) return;
    this.cargando = true;
    try {
      this.resueltas = await this.solicitudes.resueltas();
    } catch (err) {
      console.error(err);
      this.error = 'No se pudo cargar el historial.';
    } finally {
      this.cargando = false;
    }
  }

  nombre(c: ClienteConSolicitud): string {
    return [c.nombre, c.apellido].filter(Boolean).join(' ') || c.usuario || '(sin nombre)';
  }

  /** Link de WhatsApp con el teléfono del cliente (para consultarle algo antes de decidir) */
  whatsapp(c: ClienteConSolicitud): string | null {
    const tel = String(c.telefono || '').replace(/\D/g, '');
    return tel.length >= 8 ? `https://wa.me/${tel.startsWith('54') ? tel : '54' + tel}` : null;
  }

  async aprobar(c: ClienteConSolicitud) {
    const s = c.solicitudMayorista;
    const r = await Swal.fire({
      title: '¿Aprobar cuenta mayorista?',
      html: `<b>${this.escapar(this.nombre(c))}</b><br>${this.escapar(s.razonSocial)} · CUIT ${formatearCuit(s.cuit)}` +
        '<br><br>Va a ver los precios mayoristas desde su próximo ingreso a la tienda.',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Aprobar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#1e8e4a'
    });
    if (!r.isConfirmed) return;
    await this.ejecutar(c, () => this.solicitudes.aprobar(c), 'Cuenta mayorista aprobada');
  }

  async rechazar(c: ClienteConSolicitud) {
    const r = await Swal.fire({
      title: 'Rechazar solicitud',
      html: `<b>${this.escapar(this.nombre(c))}</b> sigue como minorista y ve el motivo en su cuenta.`,
      input: 'textarea',
      inputLabel: 'Motivo (lo ve el cliente)',
      inputPlaceholder: 'Ej: el CUIT no corresponde a un comercio. Escribinos por WhatsApp para revisarlo.',
      inputAttributes: { maxlength: String(MAX_MOTIVO_RECHAZO) },
      showCancelButton: true,
      confirmButtonText: 'Rechazar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#d03b3b',
      inputValidator: (v: string) => (!v || !v.trim()) ? 'Escribí un motivo para que el cliente sepa qué pasó.' : null
    });
    if (!r.isConfirmed) return;
    await this.ejecutar(c, () => this.solicitudes.rechazar(c, r.value), 'Solicitud rechazada');
  }

  private async ejecutar(c: ClienteConSolicitud, accion: () => Promise<void>, ok: string) {
    this.procesando = c.id;
    try {
      await accion();
      Swal.fire({ toast: true, position: 'top-end', timer: 2500, showConfirmButton: false, icon: 'success', title: ok });
      this.resueltas = null;   // se vuelve a leer al abrir el historial
      await this.cargar();
    } catch (err: any) {
      console.error(err);
      Swal.fire('No se pudo completar', err instanceof SolicitudMayoristaError ? err.message : 'Probá de nuevo.', 'error');
      await this.cargar();
    } finally {
      this.procesando = null;
    }
  }

  private escapar(s: any): string {
    return String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as any)[ch]);
  }

  trackId = (_: number, c: ClienteConSolicitud) => c.id;
}
