import { Injectable } from '@angular/core';
import { Auth, authState } from '@angular/fire/auth';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';
import { firstValueFrom } from 'rxjs';
import { take } from 'rxjs/operators';
import { permisosDe } from './secciones';

/**
 * Permisos del usuario logueado, leídos de Firestore (Clientes/{uid}).
 * No confía en lo guardado en el navegador (localStorage se puede editar a mano).
 *
 *  - administrador: entra al panel; ve las secciones de su lista de permisos.
 *  - superAdmin:    ve todo y administra los permisos de los demás.
 *  - dueno:         superadmin que nadie puede modificar desde la app (se marca en la consola de Firebase).
 *
 * Se guarda en memoria unos segundos para no leer Firestore en cada navegación.
 */
@Injectable({ providedIn: 'root' })
export class PermisosService {

  private static readonly VIGENCIA_MS = 60 * 1000;
  private cache: {
    uid: string; admin: boolean; superAdmin: boolean; dueno: boolean; permisos: string[]; leido: number
  } | null = null;

  constructor(private auth: Auth, private firestore: Firestore) { }

  async esSuperAdmin(): Promise<boolean> {
    return (await this.leer())?.superAdmin === true;
  }

  async esAdmin(): Promise<boolean> {
    return (await this.leer())?.admin === true;
  }

  async tienePermiso(seccion: string): Promise<boolean> {
    const p = await this.leer();
    return !!p && p.admin && (p.superAdmin || p.permisos.includes(seccion));
  }

  /** Lista de secciones habilitadas para el usuario logueado */
  async permisos(): Promise<string[]> {
    return (await this.leer())?.permisos || [];
  }

  /** uid del usuario logueado (o null) */
  async uidActual(): Promise<string | null> {
    return (await this.leer())?.uid || null;
  }

  /** Forzar a releer (por ejemplo después de cambiar permisos) */
  limpiar() {
    this.cache = null;
  }

  private async leer() {
    const user = await firstValueFrom(authState(this.auth).pipe(take(1)));
    if (!user) { this.cache = null; return null; }

    const vigente = this.cache && this.cache.uid === user.uid
      && (Date.now() - this.cache.leido) < PermisosService.VIGENCIA_MS;
    if (vigente) return this.cache;

    const snap = await getDoc(doc(this.firestore, 'Clientes', user.uid));
    const d: any = snap.exists() ? snap.data() : {};
    const admin = d.administrador === true && d.estado !== false;
    this.cache = {
      uid: user.uid,
      admin,
      superAdmin: admin && (d.superAdmin === true || d.dueno === true),
      dueno: admin && d.dueno === true,
      permisos: permisosDe(d),
      leido: Date.now()
    };
    return this.cache;
  }
}
