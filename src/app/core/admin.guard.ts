import { Injectable } from '@angular/core';
import {
  CanActivate,
  Router,
  ActivatedRouteSnapshot,
  RouterStateSnapshot
} from '@angular/router';
import { AuthService } from '../modules/auth/services/auth.service';


@Injectable({
  providedIn: 'root'
})
export class AdminGuard implements CanActivate {

  constructor(
    private authService: AuthService,
    private router: Router
  ) {}

  canActivate(
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot
  ): boolean {

    const cliente = this.authService.getClienteActualValor();

    // No hay usuario
    if (!cliente) {
      this.router.navigate(['/inicio']);
      return false;
    }

    // No es administrador
    if (!cliente.administrador) {
      this.router.navigate(['/inicio']);
      return false;
    }

    // Es administrador
    return true;
  }
}