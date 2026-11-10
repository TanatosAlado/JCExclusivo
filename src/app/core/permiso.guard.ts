import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivate, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import Swal from 'sweetalert2';
import { PermisosService } from './permisos.service';
import { seccionDeRuta } from './secciones';

/**
 * Deja entrar a una sección solo si el usuario tiene ese permiso.
 * La sección sale de route.data.seccion o, si no está, de la URL.
 * Aunque escriban la URL a mano, si no tiene permiso vuelve a Gestiones (o al inicio).
 */
@Injectable({ providedIn: 'root' })
export class PermisoGuard implements CanActivate {

  constructor(private permisos: PermisosService, private router: Router) { }

  async canActivate(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): Promise<boolean | UrlTree> {
    const seccion: string | null = route.data?.['seccion'] || seccionDeRuta(state.url);
    try {
      if (seccion && await this.permisos.tienePermiso(seccion)) return true;
    } catch (err) {
      console.error('Error verificando permisos:', err);
    }
    Swal.fire({
      toast: true, position: 'top-end', timer: 3000, showConfirmButton: false, icon: 'warning',
      title: 'No tenés permiso para entrar a esa sección'
    });
    const esAdmin = await this.permisos.esAdmin().catch(() => false);
    return this.router.createUrlTree([esAdmin ? '/gestiones' : '/inicio']);
  }
}
