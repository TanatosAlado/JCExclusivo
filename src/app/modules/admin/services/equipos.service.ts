import { Injectable } from '@angular/core';
import {
  Firestore,
  collection,
  doc,
  getDocs,
  query,
  where,
  runTransaction
} from '@angular/fire/firestore';
import { Storage, ref, uploadBytes, getDownloadURL } from '@angular/fire/storage';
import { AuditoriaService, UsuarioRegistro } from 'src/app/shared/services/auditoria.service';

/**
 * Equipos para la venta (celulares, relojes, etc.): cada uno es una UNIDAD ÚNICA identificada
 * por su IMEI. No tienen variantes ni stock: se venden una sola vez.
 *
 *   Equipos/{id}            → la ficha del equipo
 *   EquiposIMEI/{imei}      → índice: qué equipo DISPONIBLE tiene ese IMEI (evita repetidos)
 *   EquiposEliminados/{id}  → equipos dados de baja (se pueden recuperar)
 *
 * Estados: 'disponible' → 'vendido' (la venta se hace en Despacho / tienda, etapas siguientes).
 * Un equipo vendido NO se borra: queda para consultar la garantía por IMEI.
 */

export type EstadoEquipo = 'disponible' | 'vendido';
export type MonedaEquipo = 'USD' | 'ARS';
export type CondicionEquipo = 'nuevo' | 'usado';

export const CONDICIONES: { valor: CondicionEquipo; nombre: string }[] = [
  { valor: 'nuevo', nombre: 'Nuevo' },
  { valor: 'usado', nombre: 'Usado' }
];

/** Condición del equipo (los cargados antes de existir este dato eran usados) */
export function condicionDe(e: { condicion?: any } | null | undefined): CondicionEquipo {
  return e?.condicion === 'nuevo' ? 'nuevo' : 'usado';
}

export function nombreCondicion(e: { condicion?: any } | null | undefined): string {
  return condicionDe(e) === 'nuevo' ? 'Nuevo' : 'Usado';
}

export const RUBRO_EQUIPOS = 'Equipos';
export const CAPACIDADES = ['64 GB', '128 GB', '256 GB', '512 GB', '1 TB'];
export const GRADOS = ['A+', 'A', 'AB', 'B', 'C'];
export const MONEDAS: MonedaEquipo[] = ['USD', 'ARS'];

/** Cantidad máxima de fotos por equipo */
export const MAX_FOTOS_EQUIPO = 6;

/** Fotos del equipo (la primera es la principal). Los equipos viejos solo tienen "imagen". */
export function fotosDe(e: { imagenes?: any; imagen?: any } | null | undefined): string[] {
  const lista = Array.isArray(e?.imagenes) ? e!.imagenes : [];
  const fotos = lista.filter((u: any) => typeof u === 'string' && u.trim());
  if (!fotos.length && typeof e?.imagen === 'string' && e.imagen.trim()) fotos.push(e.imagen);
  return fotos.slice(0, MAX_FOTOS_EQUIPO);
}

export interface Equipo {
  id: string;
  condicion?: CondicionEquipo;  // nuevo / usado (si falta, es usado)
  modelo: string;
  color: string;
  capacidad: string;
  imei: string;
  bateria: number;              // salud de la batería (%)
  grado: string;                // solo para usados ('' en los nuevos)
  observaciones: string;
  precioMinorista: number;
  precioMayorista: number;
  moneda: MonedaEquipo;
  imagen: string;               // URL de la foto principal ('' si no tiene) = imagenes[0]
  imagenes?: string[];          // todas las fotos (la primera es la principal)
  rubro: string;                // siempre 'Equipos'
  estado: EstadoEquipo;
  creado?: { fecha: string; usuario: UsuarioRegistro | null };
  actualizado?: { fecha: string; usuario: UsuarioRegistro | null } | null;
  venta?: any;                  // datos de la venta (etapa 2)
}

/** Lo que se carga en el formulario */
export type DatosEquipo = Pick<Equipo,
  'condicion' | 'modelo' | 'color' | 'capacidad' | 'imei' | 'bateria' | 'grado' | 'observaciones' |
  'precioMinorista' | 'precioMayorista' | 'moneda' | 'imagen' | 'imagenes'>;

export class EquipoError extends Error {
  constructor(message: string) {
    super(message);
  }
}

// =====================================================
// Funciones puras (se pueden probar sin Angular)
// =====================================================

/** IMEI / nº de serie normalizado: sin espacios ni guiones, en mayúsculas */
export function normalizarImei(imei: any): string {
  return String(imei ?? '').toUpperCase().replace(/[\s\-.\/]/g, '');
}

/** Un IMEI de 15 dígitos válido (dígito verificador de Luhn) */
export function imeiValido(imei: string): boolean {
  if (!/^\d{15}$/.test(imei)) return false;
  let suma = 0;
  for (let i = 0; i < 15; i++) {
    let d = Number(imei[i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    suma += d;
  }
  return suma % 10 === 0;
}

/**
 * Valida la ficha. Devuelve la lista de errores (vacía si está todo bien).
 * El IMEI puede ser un IMEI de 15 dígitos o un nº de serie (letras y números, 5 a 20).
 */
export function validarEquipo(d: Partial<DatosEquipo>): string[] {
  const errores: string[] = [];
  const texto = (v: any) => String(v ?? '').trim();
  if (d.condicion !== 'nuevo' && d.condicion !== 'usado') errores.push('Elegí si el equipo es nuevo o usado.');
  if (texto(d.modelo).length < 2) errores.push('Ingresá el modelo.');
  if (!texto(d.color)) errores.push('Ingresá el color.');
  if (!texto(d.capacidad)) errores.push('Elegí la capacidad.');
  const imei = normalizarImei(d.imei);
  if (!imei) errores.push('El IMEI es obligatorio.');
  else if (!/^[A-Z0-9]{5,20}$/.test(imei)) errores.push('El IMEI / nº de serie solo puede tener letras y números (5 a 20).');
  const bateria = Number(d.bateria);
  if (d.bateria === null || d.bateria === undefined || String(d.bateria) === '' || isNaN(bateria) || bateria < 0 || bateria > 100) {
    errores.push('La batería tiene que ser un % entre 0 y 100.');
  }
  // El grado es solo para los usados
  if (d.condicion !== 'nuevo' && !texto(d.grado)) errores.push('Elegí el grado.');
  if (!(Number(d.precioMinorista) > 0)) errores.push('Ingresá el precio minorista.');
  if (!(Number(d.precioMayorista) > 0)) errores.push('Ingresá el precio mayorista.');
  if (!MONEDAS.includes(d.moneda as MonedaEquipo)) errores.push('Elegí la moneda.');
  return errores;
}

/** Datos limpios para guardar */
export function limpiarDatos(d: DatosEquipo): DatosEquipo {
  const r2 = (n: any) => Math.round((Number(n) || 0) * 100) / 100;
  const condicion: CondicionEquipo = d.condicion === 'nuevo' ? 'nuevo' : 'usado';
  return {
    condicion,
    modelo: String(d.modelo ?? '').trim().replace(/\s+/g, ' '),
    color: String(d.color ?? '').trim().replace(/\s+/g, ' '),
    capacidad: String(d.capacidad ?? '').trim(),
    imei: normalizarImei(d.imei),
    bateria: Math.round(Number(d.bateria)),
    grado: condicion === 'nuevo' ? '' : String(d.grado ?? '').trim(),
    observaciones: String(d.observaciones ?? '').trim(),
    precioMinorista: r2(d.precioMinorista),
    precioMayorista: r2(d.precioMayorista),
    moneda: d.moneda === 'ARS' ? 'ARS' : 'USD',
    // La primera foto es la principal (la que se usa en el carrito, despacho, etc.)
    imagen: fotosDe(d)[0] || '',
    imagenes: fotosDe(d)
  };
}

/** "14 PRO MAX · GOLD · 256 GB" */
export function nombreEquipo(e: Partial<Equipo>): string {
  return [e.modelo, e.color, e.capacidad].filter(Boolean).join(' · ');
}

/** Campos que cambiaron (para auditoría) */
export function cambiosEquipo(antes: Partial<Equipo>, despues: Partial<DatosEquipo>): string[] {
  const etiquetas: { [k: string]: string } = {
    condicion: 'condición', modelo: 'modelo', color: 'color', capacidad: 'capacidad', imei: 'IMEI', bateria: 'batería',
    grado: 'grado', observaciones: 'observaciones', precioMinorista: 'precio minorista',
    precioMayorista: 'precio mayorista', moneda: 'moneda', imagen: 'foto principal', imagenes: 'fotos'
  };
  antes = { ...antes, imagenes: fotosDe(antes) };   // los equipos viejos solo tenían "imagen"
  return Object.keys(etiquetas)
    .filter(k => String((antes as any)[k] ?? '') !== String((despues as any)[k] ?? ''))
    .map(k => k === 'imagen' || k === 'imagenes' || k === 'observaciones'
      ? etiquetas[k]
      : `${etiquetas[k]}: ${(antes as any)[k] ?? '-'} → ${(despues as any)[k] ?? '-'}`);
}

// =====================================================
// Servicio
// =====================================================

@Injectable({ providedIn: 'root' })
export class EquiposService {

  static readonly COLECCION = 'Equipos';
  static readonly INDICE_IMEI = 'EquiposIMEI';
  static readonly ELIMINADOS = 'EquiposEliminados';

  constructor(
    private firestore: Firestore,
    private storage: Storage,
    private auditoria: AuditoriaService
  ) { }

  async listar(): Promise<Equipo[]> {
    const snap = await getDocs(collection(this.firestore, EquiposService.COLECCION));
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as Equipo));
  }

  private refImei(imei: string) {
    return doc(this.firestore, EquiposService.INDICE_IMEI, imei);
  }

  /** Referencias para usar dentro de transacciones de otros servicios (venta, anulación) */
  refEquipo(id: string) {
    return doc(this.firestore, EquiposService.COLECCION, id);
  }

  refIndiceImei(imei: string) {
    return this.refImei(normalizarImei(imei));
  }

  /**
   * Equipos a la venta. La consulta filtra por estado: así la puede hacer también un visitante
   * de la tienda (las reglas solo dejan leer los equipos disponibles).
   */
  async listarDisponibles(): Promise<Equipo[]> {
    const snap = await getDocs(query(collection(this.firestore, EquiposService.COLECCION), where('estado', '==', 'disponible')));
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as Equipo));
  }

  /** Sube la foto a Storage y devuelve la URL */
  async subirFoto(file: File): Promise<string> {
    if (!file.type?.startsWith('image/')) throw new EquipoError('El archivo tiene que ser una imagen.');
    if (file.size > 10 * 1024 * 1024) throw new EquipoError('La foto no puede pesar más de 10 MB.');
    const limpio = file.name.replace(/[^\w.\-]+/g, '_').slice(-60);
    const storageRef = ref(this.storage, `equipos/${Date.now()}_${limpio}`);
    await uploadBytes(storageRef, file);
    return await getDownloadURL(storageRef);
  }

  // =====================================================
  // ALTA
  // =====================================================

  async crear(datos: DatosEquipo): Promise<Equipo> {
    const errores = validarEquipo(datos);
    if (errores.length) throw new EquipoError(errores.join(' '));
    const d = limpiarDatos(datos);
    const usuario = this.auditoria.getUsuarioActual();
    if (!usuario) throw new EquipoError('No se pudo identificar al usuario. Volvé a iniciar sesión.');

    const equipoRef = doc(collection(this.firestore, EquiposService.COLECCION));
    const imeiRef = this.refImei(d.imei);
    const equipo: Omit<Equipo, 'id'> = {
      ...d,
      rubro: RUBRO_EQUIPOS,
      estado: 'disponible',
      creado: { fecha: new Date().toISOString(), usuario },
      actualizado: null,
      venta: null
    };
    const registro = await this.auditoria.armarRegistro({
      accion: 'crear',
      entidad: EquiposService.COLECCION,
      entidadId: equipoRef.id,
      descripcion: `Alta de equipo (${nombreCondicion(d)}): ${nombreEquipo(d)} · IMEI ${d.imei} · ${d.moneda} ${d.precioMinorista} / ${d.precioMayorista}`,
      despues: equipo
    });

    await runTransaction(this.firestore, async tx => {
      const imeiSnap = await tx.get(imeiRef);
      if (imeiSnap.exists()) {
        const otro: any = imeiSnap.data();
        throw new EquipoError(`Ya hay un equipo disponible con el IMEI ${d.imei}${otro?.modelo ? ` (${otro.modelo})` : ''}.`);
      }
      tx.set(equipoRef, equipo);
      tx.set(imeiRef, { equipoId: equipoRef.id, modelo: d.modelo });
      this.auditoria.registrarEnTransaccion(tx, registro);
    });

    return { id: equipoRef.id, ...equipo };
  }

  // =====================================================
  // MODIFICACIÓN (solo equipos disponibles)
  // =====================================================

  async actualizar(equipo: Equipo, datos: DatosEquipo): Promise<Equipo> {
    const errores = validarEquipo(datos);
    if (errores.length) throw new EquipoError(errores.join(' '));
    const d = limpiarDatos(datos);
    const usuario = this.auditoria.getUsuarioActual();
    if (!usuario) throw new EquipoError('No se pudo identificar al usuario. Volvé a iniciar sesión.');

    const equipoRef = doc(this.firestore, EquiposService.COLECCION, equipo.id);
    const cambia = d.imei !== equipo.imei;
    const imeiNuevoRef = this.refImei(d.imei);
    const imeiViejoRef = this.refImei(equipo.imei);
    const cambios = cambiosEquipo(equipo, d);
    const actualizado = { fecha: new Date().toISOString(), usuario };

    const registro = await this.auditoria.armarRegistro({
      accion: 'modificar',
      entidad: EquiposService.COLECCION,
      entidadId: equipo.id,
      descripcion: `Modificó el equipo ${nombreEquipo(equipo)} (IMEI ${equipo.imei}): ${cambios.join('; ') || 'sin cambios'}`,
      antes: equipo,
      despues: d
    });

    await runTransaction(this.firestore, async tx => {
      const snap = await tx.get(equipoRef);
      const imeiNuevoSnap = cambia ? await tx.get(imeiNuevoRef) : null;
      if (!snap.exists()) throw new EquipoError('El equipo ya no existe. Actualizá el listado.');
      const actual: any = snap.data();
      if (actual.estado !== 'disponible') throw new EquipoError('El equipo ya se vendió: no se puede modificar.');
      if (cambia && imeiNuevoSnap?.exists() && (imeiNuevoSnap.data() as any)?.equipoId !== equipo.id) {
        throw new EquipoError(`Ya hay un equipo disponible con el IMEI ${d.imei}.`);
      }
      tx.update(equipoRef, { ...d, actualizado });
      if (cambia) {
        tx.delete(imeiViejoRef);
        tx.set(imeiNuevoRef, { equipoId: equipo.id, modelo: d.modelo });
      }
      this.auditoria.registrarEnTransaccion(tx, registro);
    });

    return { ...equipo, ...d, actualizado };
  }

  // =====================================================
  // BAJA (solo equipos disponibles; queda en EquiposEliminados)
  // =====================================================

  async eliminar(equipo: Equipo, motivo: string): Promise<void> {
    const usuario = this.auditoria.getUsuarioActual();
    if (!usuario) throw new EquipoError('No se pudo identificar al usuario. Volvé a iniciar sesión.');
    if (!motivo || motivo.trim().length < 3) throw new EquipoError('Ingresá el motivo de la baja.');

    const equipoRef = doc(this.firestore, EquiposService.COLECCION, equipo.id);
    const imeiRef = this.refImei(equipo.imei);
    const archivoRef = doc(this.firestore, EquiposService.ELIMINADOS, equipo.id);

    const registro = await this.auditoria.armarRegistro({
      accion: 'eliminar',
      entidad: EquiposService.COLECCION,
      entidadId: equipo.id,
      descripcion: `Dio de baja el equipo ${nombreEquipo(equipo)} (IMEI ${equipo.imei}). Motivo: ${motivo.trim()} — quedó en EquiposEliminados`,
      antes: equipo
    });

    await runTransaction(this.firestore, async tx => {
      const snap = await tx.get(equipoRef);
      const imeiSnap = await tx.get(imeiRef);
      if (!snap.exists()) throw new EquipoError('El equipo ya no existe. Actualizá el listado.');
      const actual: any = snap.data();
      if (actual.estado !== 'disponible') throw new EquipoError('Un equipo vendido no se puede dar de baja (queda para la garantía).');
      tx.set(archivoRef, {
        ...actual,
        id: equipo.id,
        eliminado: { fecha: new Date().toISOString(), usuario, motivo: motivo.trim() }
      });
      tx.delete(equipoRef);
      if (imeiSnap.exists() && (imeiSnap.data() as any)?.equipoId === equipo.id) tx.delete(imeiRef);
      this.auditoria.registrarEnTransaccion(tx, registro);
    });
  }
}
