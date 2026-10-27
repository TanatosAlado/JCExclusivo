import { Injectable } from '@angular/core';
import {
  CanActivate,
  Router,
  UrlTree,
  ActivatedRouteSnapshot,
  RouterStateSnapshot
} from '@angular/router';
import { Auth, authState } from '@angular/fire/auth';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';
import { firstValueFrom } from 'rxjs';
import { take } from 'rxjs/operators';

/**
 * Protege las rutas de administración (/gestiones y /despacho).
 *
 * No confía en lo guardado en el navegador (localStorage se puede editar a mano):
 *  1. Espera la sesión REAL de Firebase Auth.
 *  2. Lee el cliente desde Firestore (Clientes/{uid}).
 *  3. Solo deja pasar si es administrador y está habilitado.
 */
@Injectable({
  providedIn: 'root'
})
export class AdminGuard implements CanActivate {

  constructor(
    private auth: Auth,
    private firestore: Firestore,
    private router: Router
  ) {}

  async canActivate(
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot
  ): Promise<boolean | UrlTree> {

    const denegar = this.router.createUrlTree(['/inicio']);

    try {
      // authState emite cuando Firebase terminó de restaurar la sesión (también al recargar la página)
      const user = await firstValueFrom(authState(this.auth).pipe(take(1)));

      // No hay sesión iniciada
      if (!user) {
        return denegar;
      }

      const snap = await getDoc(doc(this.firestore, 'Clientes', user.uid));

      if (!snap.exists()) {
        return denegar;
      }

      const cliente: any = snap.data();

      // Debe ser administrador y estar habilitado
      if (cliente.administrador !== true || cliente.estado === false) {
        return denegar;
      }

      return true;

    } catch (err) {
      console.error('Error verificando permisos de administrador:', err);
      return denegar;
    }
  }
}
