import { Injectable } from '@angular/core';
import { Firestore, collection, doc, getDocs, query, updateDoc, where } from '@angular/fire/firestore';
import { AuditoriaService } from 'src/app/shared/services/auditoria.service';
import { PermisosService } from 'src/app/core/permisos.service';
import { SECCIONES, permisosDe } from 'src/app/core/secciones';

/** Un administrador con sus permisos (para la pantalla de Permisos) */
export interface AdminPermisos {
  id: string;
  usuario: string;
  nombre: string;
  mail: string;
  habilitado: boolean;
  superAdmin: boolean;
  dueno: boolean;
  /** true si todavía no tiene permisos cargados (usa los de por defecto) */
  porDefecto: boolean;
  /** Secciones habilitadas (las efectivas) */
  permisos: string[];
}

export class PermisosError extends Error {
  constructor(message: string) {
    super(message);
  }
}

/**
 * Administra los permisos de los administradores. Solo lo usa el superadministrador
 * (lo controlan la ruta y las reglas de Firestore).
 *
 * Protecciones (también en las reglas):
 *  - El dueño no se puede modificar desde la app.
 *  - Nadie se puede quitar su propio superadmin (para no quedarse afuera).
 */
@Injectable({ providedIn: 'root' })
export class PermisosUsuariosService {

  constructor(
    private firestore: Firestore,
    private auditoria: AuditoriaService,
    private permisosService: PermisosService
  ) { }

  async listarAdmins(): Promise<AdminPermisos[]> {
    const snap = await getDocs(query(collection(this.firestore, 'Clientes'), where('administrador', '==', true)));
    return snap.docs
      .map(d => PermisosUsuariosService.armar(d.id, d.data()))
      .sort((a, b) =>
        Number(b.dueno) - Number(a.dueno) || Number(b.superAdmin) - Number(a.superAdmin)
        || a.usuario.localeCompare(b.usuario, 'es'));
  }

  static armar(id: string, d: any): AdminPermisos {
    return {
      id,
      usuario: d.usuario || '',
      nombre: [d.nombre, d.apellido].filter(Boolean).join(' ') || d.razonSocial || '',
      mail: d.mail || '',
      habilitado: d.estado !== false,
      superAdmin: d.superAdmin === true || d.dueno === true,
      dueno: d.dueno === true,
      porDefecto: !Array.isArray(d.permisos),
      permisos: permisosDe({ ...d, estado: true })   // efectivos (aunque esté deshabilitado, para editarlos)
    };
  }

  async guardar(admin: AdminPermisos, cambios: { superAdmin: boolean; permisos: string[] }): Promise<void> {
    if (admin.dueno) throw new PermisosError('El dueño no se puede modificar desde la app.');

    const miUid = await this.permisosService.uidActual();
    if (admin.id === miUid && admin.superAdmin && !cambios.superAdmin) {
      throw new PermisosError('No te podés quitar tu propio permiso de superadministrador.');
    }

    // Solo claves válidas y en el orden del catálogo
    const validas = SECCIONES.map(s => s.clave);
    const permisos = validas.filter(c => cambios.permisos.includes(c));

    await updateDoc(doc(this.firestore, 'Clientes', admin.id), {
      superAdmin: cambios.superAdmin === true,
      permisos
    });

    const nombre = admin.usuario || admin.nombre || admin.id;
    const titulo = (c: string) => SECCIONES.find(s => s.clave === c)?.titulo || c;
    const agregados = permisos.filter(p => !admin.permisos.includes(p)).map(titulo);
    const quitados = admin.permisos.filter(p => !permisos.includes(p)).map(titulo);
    const partes: string[] = [];
    if (admin.superAdmin !== cambios.superAdmin) partes.push(cambios.superAdmin ? 'lo hizo superadministrador' : 'le quitó superadministrador');
    if (agregados.length) partes.push(`habilitó: ${agregados.join(', ')}`);
    if (quitados.length) partes.push(`quitó: ${quitados.join(', ')}`);

    await this.auditoria.registrar({
      accion: 'modificar',
      entidad: 'Clientes',
      entidadId: admin.id,
      descripcion: `Permisos de ${nombre}: ${partes.join('; ') || 'sin cambios'}`,
      antes: { superAdmin: admin.superAdmin, permisos: admin.permisos },
      despues: { superAdmin: cambios.superAdmin, permisos }
    });

    if (admin.id === miUid) this.permisosService.limpiar();
  }
}
