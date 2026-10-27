import { Injectable } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import {
  Firestore,
  collection,
  doc,
  getDoc,
  addDoc,
  serverTimestamp,
  Transaction
} from '@angular/fire/firestore';

/** Quién hizo algo (se guarda en ventas, gastos, cajas y auditoría) */
export interface UsuarioRegistro {
  uid: string;
  usuario: string;
  nombre: string;
}

export type AccionAuditoria =
  | 'crear'
  | 'modificar'
  | 'eliminar'
  | 'anular'
  | 'mover'
  | 'login'
  | 'logout'
  | 'abrir caja'
  | 'cerrar caja'
  | 'venta';

export interface EventoAuditoria {
  accion: AccionAuditoria;
  entidad: string;         // ej: 'productos', 'Clientes', 'Ventas'
  entidadId?: string;      // id del documento afectado
  descripcion: string;     // texto legible: "Modificó precio de Funda iPhone 15"
  antes?: any;             // datos previos (para calcular qué cambió)
  despues?: any;           // datos nuevos
  extra?: any;             // información adicional
}

/** Campos que no se guardan en el detalle de cambios (muy grandes o sin valor para auditar) */
const CAMPOS_IGNORADOS = ['carrito', 'historial', 'id', 'variantes'];
const MAX_LARGO_VALOR = 1500;

/**
 * Registro de auditoría: guarda en la colección 'Auditoria' quién hizo qué y cuándo.
 *
 * - La fecha la pone el SERVIDOR (no se puede falsear desde la PC).
 * - Las reglas de Firestore solo permiten CREAR registros: nadie (ni un admin)
 *   puede modificarlos ni borrarlos.
 * - Solo se registran acciones de administradores (las compras de clientes ya
 *   quedan registradas como pedidos).
 */
@Injectable({
  providedIn: 'root'
})
export class AuditoriaService {

  private ipPromise: Promise<string | null> | null = null;

  constructor(private auth: Auth, private firestore: Firestore) { }

  // =====================================================
  // USUARIO ACTUAL
  // =====================================================

  /** Usuario que inició sesión (uid de Firebase + nombre para mostrar) */
  getUsuarioActual(): UsuarioRegistro | null {
    const user = this.auth.currentUser;
    if (!user) return null;

    let usuario = '';
    let nombre = '';
    try {
      const raw = localStorage.getItem('clienteActual');
      const cliente = raw ? JSON.parse(raw) : null;
      if (cliente) {
        usuario = cliente.usuario || '';
        nombre = [cliente.nombre, cliente.apellido].filter(Boolean).join(' ');
      }
    } catch { /* sin datos locales: usamos el mail */ }

    return {
      uid: user.uid,
      usuario: usuario || user.email || user.uid,
      nombre: nombre || usuario || user.email || ''
    };
  }

  private esAdminEnSesion(): boolean {
    try {
      const raw = localStorage.getItem('clienteActual');
      return !!raw && JSON.parse(raw)?.administrador === true;
    } catch {
      return false;
    }
  }

  // =====================================================
  // REGISTRO
  // =====================================================

  /** Lee el documento ANTES de modificarlo, para poder guardar qué cambió */
  async capturar(coleccion: string, id: string): Promise<any | null> {
    if (!this.esAdminEnSesion()) return null; // solo se audita a administradores
    try {
      const snap = await getDoc(doc(this.firestore, coleccion, id));
      return snap.exists() ? snap.data() : null;
    } catch {
      return null;
    }
  }

  /**
   * Registra una acción. Nunca corta la operación principal: si falla, lo deja en consola.
   * Llamar DESPUÉS de que la operación se hizo bien.
   */
  async registrar(
    evento: EventoAuditoria,
    opciones?: { usuario?: UsuarioRegistro; esAdmin?: boolean }
  ): Promise<void> {
    if (!(opciones?.esAdmin ?? this.esAdminEnSesion())) return;

    const datos = await this.armarRegistro(evento, opciones?.usuario);
    if (!datos) return;

    try {
      await addDoc(collection(this.firestore, 'Auditoria'), datos);
    } catch (err) {
      console.error('No se pudo registrar la auditoría:', err, evento);
    }
  }

  /**
   * Registra la acción DENTRO de una transacción: si la operación falla,
   * no queda registro; si se confirma, el registro queda sí o sí.
   * (Hay que obtener el registro con armarRegistro() ANTES de abrir la transacción.)
   */
  registrarEnTransaccion(tx: Transaction, registro: any): void {
    if (!registro) return;
    tx.set(doc(collection(this.firestore, 'Auditoria')), registro);
  }

  /** Arma el documento de auditoría (async por la IP) */
  async armarRegistro(evento: EventoAuditoria, usuarioForzado?: UsuarioRegistro): Promise<any | null> {
    const usuario = usuarioForzado || this.getUsuarioActual();
    if (!usuario) return null;

    const registro: any = {
      fecha: serverTimestamp(),
      uid: usuario.uid,
      usuario: usuario.usuario,
      nombre: usuario.nombre,
      ip: await this.obtenerIp(),
      navegador: (navigator?.userAgent || '').slice(0, 300),
      accion: evento.accion,
      entidad: evento.entidad,
      entidadId: evento.entidadId || null,
      descripcion: evento.descripcion
    };

    const cambios = this.calcularCambios(evento.antes, evento.despues);
    if (cambios) registro.cambios = cambios;

    // Una modificación que no cambió nada auditable no se registra (ej: solo el carrito)
    if (evento.accion === 'modificar' && evento.antes && evento.despues && !cambios) {
      return null;
    }

    if (evento.accion === 'eliminar' && evento.antes) {
      registro.datosEliminados = this.limpiar(this.recortar(evento.antes));
    }

    if (evento.extra !== undefined) {
      registro.extra = this.limpiar(evento.extra);
    }

    return registro;
  }

  // =====================================================
  // AUXILIARES
  // =====================================================

  /**
   * IP pública del equipo (se consulta una vez por sesión).
   * Aviso: la obtiene el navegador, así que es orientativa; una IP 100% confiable
   * requiere una función del lado del servidor (Cloud Functions).
   */
  private obtenerIp(): Promise<string | null> {
    if (!this.ipPromise) {
      this.ipPromise = (async () => {
        try {
          const guardada = sessionStorage.getItem('ipAuditoria');
          if (guardada) return guardada;
        } catch { }

        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 2500);
          const r = await fetch('https://api.ipify.org?format=json', { signal: ctrl.signal });
          clearTimeout(timer);
          const ip = (await r.json())?.ip || null;
          if (ip) {
            try { sessionStorage.setItem('ipAuditoria', ip); } catch { }
          }
          return ip;
        } catch {
          return null;
        }
      })();
    }
    return this.ipPromise;
  }

  /** { campo: { antes, despues } } solo con lo que cambió */
  private calcularCambios(antes: any, despues: any): any | null {
    if (!despues || typeof despues !== 'object') return null;

    const cambios: any = {};
    for (const campo of Object.keys(despues)) {
      if (CAMPOS_IGNORADOS.includes(campo)) continue;
      const a = antes ? antes[campo] : undefined;
      const d = despues[campo];
      if (JSON.stringify(a ?? null) !== JSON.stringify(d ?? null)) {
        cambios[campo] = {
          antes: this.valorCorto(a),
          despues: this.valorCorto(d)
        };
      }
    }
    return Object.keys(cambios).length ? cambios : null;
  }

  private valorCorto(v: any): any {
    if (v === undefined) return null;
    const texto = JSON.stringify(v);
    if (texto && texto.length > MAX_LARGO_VALOR) {
      return texto.slice(0, MAX_LARGO_VALOR) + '… (recortado)';
    }
    return this.limpiar(v);
  }

  private recortar(obj: any): any {
    const copia: any = {};
    for (const [k, v] of Object.entries(obj || {})) {
      if (CAMPOS_IGNORADOS.includes(k)) continue;
      copia[k] = this.valorCorto(v);
    }
    return copia;
  }

  /** Firestore no acepta undefined */
  private limpiar(v: any): any {
    try {
      return JSON.parse(JSON.stringify(v ?? null));
    } catch {
      return String(v);
    }
  }
}
