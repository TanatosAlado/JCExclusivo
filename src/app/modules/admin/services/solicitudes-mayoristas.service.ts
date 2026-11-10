import { Injectable } from '@angular/core';
import { collection, doc, Firestore, getDocs, query, runTransaction, where } from '@angular/fire/firestore';
import { AuditoriaService } from 'src/app/shared/services/auditoria.service';
import {
  EstadoSolicitudMayorista, formatearCuit, MAX_MOTIVO_RECHAZO, ordenarSolicitudes, SolicitudMayorista
} from 'src/app/shared/utils/solicitud-mayorista';

export interface ClienteConSolicitud {
  id: string;
  nombre: string;
  apellido: string;
  usuario: string;
  dni: number | string;
  mail: string;
  telefono: string;
  direccion: string;
  esMayorista: boolean;
  solicitudMayorista: SolicitudMayorista;
}

export class SolicitudMayoristaError extends Error {
  constructor(message: string) {
    super(message);
  }
}

/**
 * Solicitudes para ser cliente mayorista (Gestiones → Solicitudes mayoristas).
 * Aprobar pone esMayorista = true; rechazar deja la cuenta como minorista con el motivo.
 */
@Injectable({ providedIn: 'root' })
export class SolicitudesMayoristasService {

  constructor(private firestore: Firestore, private auditoria: AuditoriaService) { }

  private async porEstado(estados: EstadoSolicitudMayorista[]): Promise<ClienteConSolicitud[]> {
    const snap = await getDocs(query(
      collection(this.firestore, 'Clientes'),
      where('solicitudMayorista.estado', 'in', estados)
    ));
    return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
  }

  /** Pendientes (las más nuevas primero) */
  async pendientes(): Promise<ClienteConSolicitud[]> {
    return ordenarSolicitudes(await this.porEstado(['pendiente']));
  }

  /** Ya resueltas (las últimas 50) */
  async resueltas(): Promise<ClienteConSolicitud[]> {
    return ordenarSolicitudes(await this.porEstado(['aprobada', 'rechazada'])).slice(0, 50);
  }

  async cantidadPendientes(): Promise<number> {
    return (await this.porEstado(['pendiente'])).length;
  }

  async aprobar(cliente: ClienteConSolicitud): Promise<void> {
    await this.resolver(cliente, 'aprobada', null);
  }

  async rechazar(cliente: ClienteConSolicitud, motivo: string): Promise<void> {
    const m = String(motivo || '').trim().slice(0, MAX_MOTIVO_RECHAZO);
    await this.resolver(cliente, 'rechazada', m || null);
  }

  /** En una transacción: si otro administrador ya la resolvió, no se pisa */
  private async resolver(cliente: ClienteConSolicitud, estado: 'aprobada' | 'rechazada', motivo: string | null) {
    const usuario = this.auditoria.getUsuarioActual();
    if (!usuario) throw new SolicitudMayoristaError('No se pudo identificar al usuario. Volvé a iniciar sesión.');

    const ref = doc(this.firestore, 'Clientes', cliente.id);
    const ahora = new Date().toISOString();
    let solicitud: SolicitudMayorista | null = null;

    await runTransaction(this.firestore, async tx => {
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new SolicitudMayoristaError('El cliente ya no existe.');
      const datos: any = snap.data();
      const actual: SolicitudMayorista | undefined = datos.solicitudMayorista;
      if (actual?.estado !== 'pendiente') {
        throw new SolicitudMayoristaError('Esta solicitud ya fue resuelta por otro administrador. Actualizá la lista.');
      }
      solicitud = {
        ...actual,
        estado,
        motivo: estado === 'rechazada' ? motivo : null,
        resueltaPor: { uid: usuario.uid, nombre: usuario.nombre || usuario.usuario || '' },
        resueltaEn: ahora
      };
      const cambios: any = { solicitudMayorista: solicitud };
      if (estado === 'aprobada') {
        cambios.esMayorista = true;
        cambios.razonSocial = actual.razonSocial;
        cambios.cuit = actual.cuit;
      }
      tx.update(ref, cambios);
    });

    const nombre = [cliente.nombre, cliente.apellido].filter(Boolean).join(' ') || cliente.usuario;
    this.auditoria.registrar({
      accion: 'modificar',
      entidad: 'Clientes',
      entidadId: cliente.id,
      descripcion: estado === 'aprobada'
        ? `Aprobó la cuenta mayorista de ${nombre} (${solicitud!.razonSocial}, CUIT ${formatearCuit(solicitud!.cuit)})`
        : `Rechazó la cuenta mayorista de ${nombre}` + (motivo ? `. Motivo: ${motivo}` : ''),
      antes: { esMayorista: false, solicitud: 'pendiente' },
      despues: { esMayorista: estado === 'aprobada', solicitud: estado }
    });
  }
}
