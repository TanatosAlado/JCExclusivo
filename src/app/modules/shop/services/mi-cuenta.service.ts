import { Injectable } from '@angular/core';
import { Auth, EmailAuthProvider, onAuthStateChanged, reauthenticateWithCredential, updatePassword, User } from '@angular/fire/auth';
import { collection, doc, Firestore, getDoc, getDocs, query, updateDoc, where } from '@angular/fire/firestore';
import { AuthService } from 'src/app/modules/auth/services/auth.service';
import { GeneralService } from 'src/app/shared/services/general.service';
import { armarHistorial, COLECCIONES_PEDIDOS, CompraHistorial } from 'src/app/shared/utils/historial-cliente';
import { errorDatosSolicitud, nuevaSolicitud, puedePedirMayorista, SolicitudMayorista } from 'src/app/shared/utils/solicitud-mayorista';

export class MiCuentaError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export const MIN_LARGO_CLAVE = 6;   // mínimo de Firebase

/**
 * "Mi cuenta" del cliente de la tienda: sus datos, cambio de contraseña e historial de compras.
 * Todo con la sesión de Firebase del propio cliente (las reglas solo le dejan leer lo suyo).
 */
@Injectable({ providedIn: 'root' })
export class MiCuentaService {

  constructor(
    private auth: Auth,
    private firestore: Firestore,
    private authService: AuthService,
    private generalService: GeneralService
  ) { }

  /** Usuario de Firebase (al recargar la página tarda un instante en estar listo) */
  private usuarioFirebase(): Promise<User | null> {
    if (this.auth.currentUser) return Promise.resolve(this.auth.currentUser);
    return new Promise(resolve => {
      const corte = onAuthStateChanged(this.auth, u => { corte(); resolve(u); });
    });
  }

  private async uidActual(): Promise<string> {
    const u = await this.usuarioFirebase();
    if (!u) throw new MiCuentaError('Tu sesión venció. Volvé a iniciar sesión.');
    return u.uid;
  }

  // =====================================================
  // DATOS
  // =====================================================

  /** Datos actualizados del cliente (puntos, teléfono, dirección, historial…) */
  async obtenerCliente(): Promise<any> {
    const uid = await this.uidActual();
    const snap = await getDoc(doc(this.firestore, 'Clientes', uid));
    if (!snap.exists()) throw new MiCuentaError('No encontramos tu cuenta.');
    return { id: uid, ...(snap.data() as any) };
  }

  /** Teléfono y dirección (el usuario, el DNI y el mail no se cambian desde acá) */
  async actualizarDatos(datos: { telefono: string; direccion: string }): Promise<void> {
    const telefono = String(datos.telefono || '').trim().slice(0, 40);
    const direccion = String(datos.direccion || '').trim().slice(0, 200);
    if (!telefono) throw new MiCuentaError('Ingresá un teléfono de contacto.');

    const uid = await this.uidActual();
    await updateDoc(doc(this.firestore, 'Clientes', uid), { telefono, direccion });

    // Que el resto de la tienda (checkout, barra) vea los datos nuevos
    const actual: any = this.authService.getClienteActualValor();
    if (actual?.id === uid) this.authService.setUsuarioActual({ ...actual, telefono, direccion });
    const enTienda: any = this.generalService.getClienteActual();
    if (enTienda?.id === uid) {
      this.generalService.setCliente({ ...enTienda, telefono, direccion });
      try { localStorage.setItem('cliente', JSON.stringify({ ...enTienda, telefono, direccion })); } catch { }
    }
  }

  // =====================================================
  // CUENTA MAYORISTA
  // =====================================================

  /** Pide pasar a mayorista: queda pendiente hasta que un administrador la apruebe */
  async pedirMayorista(cliente: any, datos: { razonSocial: string; cuit: string }): Promise<SolicitudMayorista> {
    if (!puedePedirMayorista(cliente)) throw new MiCuentaError('Ya tenés una solicitud en revisión o tu cuenta ya es mayorista.');
    const error = errorDatosSolicitud(datos);
    if (error) throw new MiCuentaError(error);
    const solicitud = nuevaSolicitud(datos);

    const uid = await this.uidActual();
    await updateDoc(doc(this.firestore, 'Clientes', uid), { solicitudMayorista: solicitud });

    // Que la sesión guardada también lo sepa (para el aviso y "Mi cuenta")
    const actual: any = this.authService.getClienteActualValor();
    if (actual?.id === uid) this.authService.setUsuarioActual({ ...actual, solicitudMayorista: solicitud });
    try { localStorage.setItem(`avisoMayorista:${uid}:pendiente:${solicitud.fecha}`, '1'); } catch { }
    return solicitud;
  }

  // =====================================================
  // CONTRASEÑA
  // =====================================================

  /** Pide la contraseña actual (Firebase exige haber entrado hace poco para cambiarla) */
  async cambiarClave(actual: string, nueva: string): Promise<void> {
    if (!actual) throw new MiCuentaError('Ingresá tu contraseña actual.');
    if (!nueva || nueva.length < MIN_LARGO_CLAVE) {
      throw new MiCuentaError(`La contraseña nueva tiene que tener al menos ${MIN_LARGO_CLAVE} caracteres.`);
    }
    if (nueva === actual) throw new MiCuentaError('La contraseña nueva tiene que ser distinta de la actual.');

    const u = await this.usuarioFirebase();
    if (!u?.email) throw new MiCuentaError('Tu sesión venció. Volvé a iniciar sesión.');

    try {
      await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, actual));
    } catch (err: any) {
      const codigo = err?.code || '';
      if (['auth/wrong-password', 'auth/invalid-credential', 'auth/invalid-login-credentials'].includes(codigo)) {
        throw new MiCuentaError('La contraseña actual no es correcta (ojo con las mayúsculas).');
      }
      if (codigo === 'auth/too-many-requests') {
        throw new MiCuentaError('Demasiados intentos. Esperá unos minutos y probá de nuevo.');
      }
      throw err;
    }

    try {
      await updatePassword(u, nueva);
    } catch (err: any) {
      if (err?.code === 'auth/weak-password') {
        throw new MiCuentaError('La contraseña nueva es muy débil. Probá con una más larga.');
      }
      throw err;
    }
  }

  // =====================================================
  // HISTORIAL
  // =====================================================

  /** Pedidos web + tickets del local, del más nuevo al más viejo */
  async obtenerHistorial(cliente: any): Promise<CompraHistorial[]> {
    const uid = await this.uidActual();

    const lecturasPedidos = COLECCIONES_PEDIDOS.map(async ({ coleccion }) => {
      try {
        const snap = await getDocs(query(collection(this.firestore, coleccion), where('clienteId', '==', uid)));
        return snap.docs.map(d => ({ coleccion, data: { id: d.id, ...(d.data() as any) } }));
      } catch (err) {
        console.warn('No se pudieron leer los pedidos de', coleccion, err);
        return [];
      }
    });

    const lecturaVentas = (async () => {
      try {
        const snap = await getDocs(query(collection(this.firestore, 'Ventas'), where('cliente.id', '==', uid)));
        return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      } catch (err) {
        console.warn('No se pudieron leer los tickets del local', err);
        return [];
      }
    })();

    const [pedidos, ventas] = await Promise.all([Promise.all(lecturasPedidos), lecturaVentas]);
    const moneda = (n: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(Number(n) || 0);
    return armarHistorial(pedidos.flat(), cliente?.historial || [], ventas, moneda);
  }
}
