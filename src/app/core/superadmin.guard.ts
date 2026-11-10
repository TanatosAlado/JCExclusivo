import { Injectable } from '@angular/core';
import { CanActivate, Router, UrlTree } from '@angular/router';
import Swal from 'sweetalert2';
import { PermisosService } from './permisos.service';

/**
 * Protege lo que es solo del superadministrador (la pantalla de Permisos de usuarios).
 * Las demás secciones usan PermisoGuard (permiso por sección).
 * Aunque escriban la URL a mano, si no es superadmin vuelve a Gestiones.
 */
@Injectable({ providedIn: 'root' })
export class SuperAdminGuard implements CanActivate {

  constructor(private permisos: PermisosService, private router: Router) { }

  async canActivate(): Promise<boolean | UrlTree> {
    try {
      if (await this.permisos.esSuperAdmin()) return true;
    } catch (err) {
      console.error('Error verificando permisos de superadministrador:', err);
    }
    Swal.fire({
      toast: true, position: 'top-end', timer: 3000, showConfirmButton: false, icon: 'warning',
      title: 'No tenés permiso para entrar a esa sección'
    });
    return this.router.createUrlTree(['/gestiones']);
  }
}
