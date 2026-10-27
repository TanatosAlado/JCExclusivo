import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { RegistroComponent } from '../views/registro/registro.component';
import { MatDialog } from '@angular/material/dialog';
import { Cliente } from '../models/cliente.model';
import { Auth, signInWithEmailAndPassword, sendPasswordResetEmail, signOut } from '@angular/fire/auth';
import { collection, doc, Firestore, getDoc, getDocs, limit, query, setDoc, where } from '@angular/fire/firestore';
import { GeneralService } from 'src/app/shared/services/general.service';
import { AuditoriaService } from 'src/app/shared/services/auditoria.service';

@Injectable({
  providedIn: 'root'
})
export class AuthService {

  private clienteActual: Cliente | null = null;
  private readonly STORAGE_KEY = 'clienteActual';
  private clienteActualSubject = new BehaviorSubject<Cliente | null>(null);

  constructor(
    private dialog: MatDialog,
    private auth: Auth,
    private firestore: Firestore,
    private generalService: GeneralService,
    private auditoria: AuditoriaService
  ) {

    const data = localStorage.getItem(this.STORAGE_KEY);

    if (data) {

      const cliente = JSON.parse(data) as Cliente;

      this.clienteActual = cliente;

      this.clienteActualSubject.next(cliente);
    }
  }

  openRegistroModal(): Observable<any> {
    const dialogRef = this.dialog.open(RegistroComponent, {
      width: '90vw',
      maxWidth: '950px',
      data: {},
    });

    return dialogRef.afterClosed();
  }

  // =====================================================
  // ÍNDICE DE USUARIOS
  // Colección 'Usuarios/{NOMBRE_USUARIO}' → { mail, uid }
  // Permite iniciar sesión con nombre de usuario SIN poder leer
  // la colección Clientes completa (que tiene datos personales).
  // =====================================================

  /** Busca el mail asociado a un nombre de usuario */
  async obtenerMailDeUsuario(usuarioNormalizado: string): Promise<string | null> {

    // 1) Índice nuevo
    const indice = await getDoc(doc(this.firestore, 'Usuarios', usuarioNormalizado));
    if (indice.exists()) {
      return (indice.data() as any).mail || null;
    }

    // 2) Compatibilidad: búsqueda vieja en Clientes.
    //    Funciona solo mientras las reglas de Firestore lo permitan;
    //    con las reglas nuevas falla y se toma como "usuario no encontrado".
    try {
      const q = query(
        collection(this.firestore, 'Clientes'),
        where('usuario', '==', usuarioNormalizado),
        limit(1)
      );
      const snapshot = await getDocs(q);
      if (!snapshot.empty) {
        return (snapshot.docs[0].data() as Cliente).mail || null;
      }
    } catch (err) {
      console.warn('Búsqueda de usuario en Clientes no permitida (se usa solo el índice):', err);
    }

    return null;
  }

  /** ¿Ya existe ese nombre de usuario? (para el registro) */
  async existeUsuario(usuarioNormalizado: string): Promise<boolean> {
    return (await this.obtenerMailDeUsuario(usuarioNormalizado)) !== null;
  }

  /** Crea la entrada del índice para el usuario que acaba de iniciar sesión / registrarse */
  async registrarEnIndice(usuarioNormalizado: string, uid: string, mail: string): Promise<void> {
    const ref = doc(this.firestore, 'Usuarios', usuarioNormalizado);
    const existente = await getDoc(ref);
    if (existente.exists()) return;
    await setDoc(ref, { uid, mail });
  }

  /**
   * Completa el índice con TODOS los clientes existentes.
   * Solo funciona siendo administrador. Se ejecuta una vez por sesión al entrar a Gestiones.
   */
  async sincronizarIndiceUsuarios(): Promise<{ creados: number; duplicados: string[] }> {

    const [clientesSnap, indiceSnap] = await Promise.all([
      getDocs(collection(this.firestore, 'Clientes')),
      getDocs(collection(this.firestore, 'Usuarios'))
    ]);

    const yaIndexados = new Set(indiceSnap.docs.map(d => d.id));
    const vistos = new Map<string, string>();
    const duplicados: string[] = [];
    let creados = 0;

    for (const clienteDoc of clientesSnap.docs) {
      const data: any = clienteDoc.data();
      const usuario = (data.usuario || '').toString().trim().toUpperCase();
      if (!usuario || !data.mail || usuario.includes('/')) continue;

      if (vistos.has(usuario) && vistos.get(usuario) !== clienteDoc.id) {
        duplicados.push(usuario);
        continue;
      }
      vistos.set(usuario, clienteDoc.id);

      if (!yaIndexados.has(usuario)) {
        await setDoc(doc(this.firestore, 'Usuarios', usuario), {
          uid: clienteDoc.id,
          mail: data.mail
        });
        creados++;
      }
    }

    if (duplicados.length) {
      console.warn('Nombres de usuario repetidos (revisar a mano):', duplicados);
    }

    return { creados, duplicados };
  }

  async login(username: string, clave: string): Promise<Cliente | null> {

    const usuarioNormalizado = username
      .trim()
      .toUpperCase();

    const email = await this.obtenerMailDeUsuario(usuarioNormalizado);

    if (!email) {
      throw new Error(
        'Nombre de usuario no encontrado'
      );
    }

    const cred = await signInWithEmailAndPassword(
      this.auth,
      email,
      clave
    );

    const ref = doc(
      this.firestore,
      'Clientes',
      cred.user.uid
    );

    const userDoc = await getDoc(ref);

    if (!userDoc.exists()) {
      return null;
    }

    // Si este usuario todavía no estaba en el índice, lo agregamos
    try {
      await this.registrarEnIndice(usuarioNormalizado, cred.user.uid, cred.user.email || email);
    } catch (err) {
      console.warn('No se pudo registrar el usuario en el índice:', err);
    }

    const cliente = userDoc.data() as Cliente;

    // Auditoría: inicio de sesión de administradores
    if (cliente.administrador === true) {
      this.auditoria.registrar(
        { accion: 'login', entidad: 'Sesiones', entidadId: cred.user.uid, descripcion: 'Inició sesión' },
        {
          esAdmin: true,
          usuario: {
            uid: cred.user.uid,
            usuario: cliente.usuario || usuarioNormalizado,
            nombre: [cliente.nombre, cliente.apellido].filter(Boolean).join(' ') || usuarioNormalizado
          }
        }
      );
    }

    return cliente;
  }


  setUsuarioActual(cliente: Cliente): void {

    this.clienteActual = cliente;

    this.clienteActualSubject.next(cliente);

    localStorage.setItem(
      this.STORAGE_KEY,
      JSON.stringify(cliente)
    );
  }

  getUsuarioActual(): Observable<Cliente | null> {
    return this.clienteActualSubject.asObservable();
  }

  getClienteActualValor(): Cliente | null {
    return this.clienteActualSubject.value;
  }

  estaLogueado(): boolean {
    return !!this.clienteActual;
  }

  logout(): void {
    // Auditoría (antes de cerrar la sesión de Firebase, para que quede quién fue).
    // Después cerramos también la sesión de Firebase (antes quedaba abierta y
    // el usuario seguía autenticado aunque "cerrara sesión").
    const saliente = this.clienteActual;
    const uid = this.auth.currentUser?.uid;
    this.auditoria
      .registrar(
        { accion: 'logout', entidad: 'Sesiones', entidadId: uid, descripcion: 'Cerró sesión' },
        {
          esAdmin: saliente?.administrador === true,
          usuario: uid ? {
            uid,
            usuario: saliente?.usuario || '',
            nombre: [saliente?.nombre, saliente?.apellido].filter(Boolean).join(' ') || saliente?.usuario || ''
          } : undefined
        }
      )
      .finally(() => signOut(this.auth).catch(err => console.error('Error cerrando sesión en Firebase:', err)));

    this.generalService.setCliente(null);
    this.clienteActual = null;
    this.clienteActualSubject.next(null);
    localStorage.removeItem(this.STORAGE_KEY);
    localStorage.removeItem('cliente');
  }


  async recuperarPassword(email: string): Promise<void> {
    return await sendPasswordResetEmail(this.auth, email);
  }


async normalizarUsuariosClientes(): Promise<void> {

  try {

    const clientesRef = collection(this.firestore, 'Clientes');

    const snapshot = await getDocs(clientesRef);

    console.log(`Clientes encontrados: ${snapshot.size}`);

    let cantidadCambios = 0;

    for (const clienteDoc of snapshot.docs) {

      const data = clienteDoc.data() as any;

      const usuarioOriginal = data.usuario;

      if (!usuarioOriginal) {
        continue;
      }

      const usuarioNormalizado = usuarioOriginal
        .toString()
        .trim()
        .toUpperCase();

      // Si ya está normalizado, no hacemos nada
      if (usuarioOriginal === usuarioNormalizado) {
        continue;
      }

      console.log(
        `Usuario: "${usuarioOriginal}" → "${usuarioNormalizado}"`
      );

      cantidadCambios++;

      // 🔥 Actualizar Firestore
      await setDoc(
        doc(this.firestore, 'Clientes', clienteDoc.id),
        {
          usuario: usuarioNormalizado
        },
        { merge: true }
      );
    }

    console.log(
      `✅ Normalización terminada. Usuarios modificados: ${cantidadCambios}`
    );

  } catch (error) {

    console.error(
      '❌ Error normalizando usuarios:',
      error
    );

  }
}

}
