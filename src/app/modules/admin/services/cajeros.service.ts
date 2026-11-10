import { Injectable } from '@angular/core';
import {
  Firestore, collection, collectionData, doc, addDoc, updateDoc, getDocs, query, where, serverTimestamp
} from '@angular/fire/firestore';
import { Observable, map } from 'rxjs';
import { AuditoriaService } from 'src/app/shared/services/auditoria.service';

/**
 * Cajero: persona que cobra en despacho (la caja la abre un usuario del sistema,
 * pero varias cajeras pueden cobrar con esa sesión abierta).
 * No se borran nunca: se dan de baja (las ventas viejas siguen apuntando a ellos).
 */
export interface Cajero {
  id?: string;
  nombre: string;
  apellido: string;
  dni: number;
  activo: boolean;
  fechaAlta?: any;
  creadoPor?: { uid: string; usuario: string; nombre: string } | null;
  fechaBaja?: any;
  bajaPor?: { uid: string; usuario: string; nombre: string } | null;
}

/** Lo que se guarda en la venta (copia: no cambia si después se edita el cajero) */
export interface CajeroVenta {
  id: string;
  nombre: string;
  apellido: string;
  dni: number;
}

export class CajeroError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export function nombreCajero(c: { nombre?: string; apellido?: string } | null | undefined): string {
  if (!c) return '';
  return [c.nombre, c.apellido].filter(Boolean).join(' ').trim();
}

export function cajeroParaVenta(c: Cajero): CajeroVenta {
  return { id: c.id as string, nombre: c.nombre, apellido: c.apellido, dni: c.dni };
}

@Injectable({ providedIn: 'root' })
export class CajerosService {

  private readonly coleccion = 'Cajeros';

  constructor(private firestore: Firestore, private auditoria: AuditoriaService) { }

  /** Todos (activos e inactivos), en tiempo real, ordenados por apellido */
  listar(): Observable<Cajero[]> {
    return (collectionData(collection(this.firestore, this.coleccion), { idField: 'id' }) as Observable<Cajero[]>)
      .pipe(map(lista => [...lista].sort(CajerosService.ordenar)));
  }

  /** Solo los activos (para elegir en despacho) */
  async listarActivos(): Promise<Cajero[]> {
    const snap = await getDocs(query(collection(this.firestore, this.coleccion), where('activo', '==', true)));
    return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as Cajero)).sort(CajerosService.ordenar);
  }

  async crear(datos: { nombre: string; apellido: string; dni: any }): Promise<string> {
    const limpio = this.validar(datos);
    await this.verificarDniLibre(limpio.dni);
    const usuario = this.auditoria.getUsuarioActual();
    const nuevo: Cajero = { ...limpio, activo: true, fechaAlta: serverTimestamp(), creadoPor: usuario || null };
    const ref = await addDoc(collection(this.firestore, this.coleccion), nuevo);
    await this.auditoria.registrar({
      accion: 'crear',
      entidad: this.coleccion,
      entidadId: ref.id,
      descripcion: `Alta de cajero ${nombreCajero(limpio)} (DNI ${limpio.dni})`,
      despues: limpio
    });
    return ref.id;
  }

  async actualizar(cajero: Cajero, datos: { nombre: string; apellido: string; dni: any }): Promise<void> {
    if (!cajero.id) throw new CajeroError('Cajero inválido.');
    const limpio = this.validar(datos);
    if (limpio.dni !== cajero.dni) await this.verificarDniLibre(limpio.dni, cajero.id);
    await updateDoc(doc(this.firestore, this.coleccion, cajero.id), limpio as any);
    await this.auditoria.registrar({
      accion: 'modificar',
      entidad: this.coleccion,
      entidadId: cajero.id,
      descripcion: `Modificó el cajero ${nombreCajero(limpio)}`,
      antes: { nombre: cajero.nombre, apellido: cajero.apellido, dni: cajero.dni },
      despues: limpio
    });
  }

  async darDeBaja(cajero: Cajero): Promise<void> {
    await this.cambiarEstado(cajero, false);
  }

  async reactivar(cajero: Cajero): Promise<void> {
    if (cajero.dni) await this.verificarDniLibre(cajero.dni, cajero.id);
    await this.cambiarEstado(cajero, true);
  }

  // =====================================================

  private async cambiarEstado(cajero: Cajero, activo: boolean) {
    if (!cajero.id) throw new CajeroError('Cajero inválido.');
    const usuario = this.auditoria.getUsuarioActual();
    await updateDoc(doc(this.firestore, this.coleccion, cajero.id), activo
      ? { activo: true, fechaBaja: null, bajaPor: null }
      : { activo: false, fechaBaja: serverTimestamp(), bajaPor: usuario || null });
    await this.auditoria.registrar({
      accion: 'modificar',
      entidad: this.coleccion,
      entidadId: cajero.id,
      descripcion: `${activo ? 'Reactivó' : 'Dio de baja'} al cajero ${nombreCajero(cajero)}`,
      antes: { activo: !activo },
      despues: { activo }
    });
  }

  private validar(datos: { nombre: string; apellido: string; dni: any }) {
    const nombre = CajerosService.capitalizar(datos.nombre);
    const apellido = CajerosService.capitalizar(datos.apellido);
    const dni = Number(String(datos.dni ?? '').replace(/\D/g, ''));
    if (!nombre) throw new CajeroError('Ingresá el nombre.');
    if (!apellido) throw new CajeroError('Ingresá el apellido.');
    if (!dni || String(dni).length < 6 || String(dni).length > 9) throw new CajeroError('Ingresá un DNI válido (solo números).');
    return { nombre, apellido, dni };
  }

  /** No puede haber dos cajeros ACTIVOS con el mismo DNI */
  private async verificarDniLibre(dni: number, excluirId?: string) {
    const snap = await getDocs(query(collection(this.firestore, this.coleccion), where('dni', '==', dni)));
    const otro = snap.docs.find(d => d.id !== excluirId && (d.data() as any).activo !== false);
    if (otro) {
      const o: any = otro.data();
      throw new CajeroError(`Ya hay un cajero activo con el DNI ${dni}: ${nombreCajero(o)}.`);
    }
  }

  static capitalizar(texto: any): string {
    return String(texto ?? '').trim().replace(/\s+/g, ' ')
      .toLowerCase().replace(/(^|[\s'-])(\S)/g, (_, a, b) => a + b.toUpperCase());
  }

  static ordenar(a: Cajero, b: Cajero): number {
    return `${a.apellido} ${a.nombre}`.localeCompare(`${b.apellido} ${b.nombre}`, 'es');
  }
}
