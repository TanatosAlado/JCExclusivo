import { Injectable } from '@angular/core';
import {
  Firestore, collection, deleteDoc, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, setDoc, where
} from '@angular/fire/firestore';
import { AuditoriaService } from 'src/app/shared/services/auditoria.service';
import { ModeloTasador, ResultadoTasacion, validarModelo } from 'src/app/shared/utils/tasador';

export class TasadorError extends Error { }

/** Una tasación guardada (historial) */
export interface Tasacion extends ResultadoTasacion {
  id: string;
  fecha: string;
  origen: 'despacho' | 'gestiones' | 'web';
  usuario: any;
  cajero?: any;
}

/**
 * 🧮 Tasador de equipos usados.
 *  - Tasador/{id}: modelos con precio por capacidad (USD) y sus preguntas Sí/No.
 *  - Tasaciones/{id}: historial de tasaciones hechas (en Despacho o probando en Gestiones).
 */
@Injectable({ providedIn: 'root' })
export class TasadorService {

  constructor(private firestore: Firestore, private auditoria: AuditoriaService) { }

  /** Modelos ordenados por nombre (con o sin los inactivos) */
  async modelos(soloActivos = false): Promise<ModeloTasador[]> {
    const snap = await getDocs(collection(this.firestore, 'Tasador'));
    return snap.docs
      .map(d => ({ id: d.id, ...(d.data() as any) }) as ModeloTasador)
      .filter(m => !soloActivos || m.activo !== false)
      .sort((a, b) => (Number(a.orden) || 0) - (Number(b.orden) || 0) ||
        String(a.nombre).localeCompare(String(b.nombre), 'es', { numeric: true }));
  }

  /** Crea o actualiza un modelo. Devuelve el id. */
  async guardar(m: ModeloTasador): Promise<string> {
    const v = validarModelo(m);
    if (!v.modelo) throw new TasadorError(v.error || 'Revisá los datos.');
    const nuevo = !m.id;
    const ref = m.id ? doc(this.firestore, 'Tasador', m.id) : doc(collection(this.firestore, 'Tasador'));
    const { id, ...datos } = v.modelo as any;
    await setDoc(ref, { ...datos, actualizado: serverTimestamp() });
    this.auditoria.registrar({
      accion: nuevo ? 'crear' : 'modificar',
      entidad: 'Tasador',
      entidadId: ref.id,
      descripcion: `${nuevo ? 'Agregó' : 'Modificó'} el modelo "${datos.nombre}" del tasador ` +
        `(${datos.capacidades.map((c: any) => `${c.capacidad} USD ${c.precio}`).join(', ')} · ${datos.preguntas.length} pregunta(s))` +
        (datos.activo ? '' : ' · inactivo')
    });
    return ref.id;
  }

  async eliminar(m: ModeloTasador): Promise<void> {
    if (!m?.id) return;
    await deleteDoc(doc(this.firestore, 'Tasador', m.id));
    this.auditoria.registrar({
      accion: 'eliminar', entidad: 'Tasador', entidadId: m.id,
      descripcion: `Eliminó el modelo "${m.nombre}" del tasador`
    });
  }

  /** Guarda la tasación en el historial (no frena nada si falla) */
  async registrar(r: ResultadoTasacion, origen: 'despacho' | 'gestiones', cajero: any = null): Promise<string | null> {
    try {
      const ref = doc(collection(this.firestore, 'Tasaciones'));
      await setDoc(ref, {
        ...r,
        fecha: new Date().toISOString(),
        origen,
        usuario: this.auditoria.getUsuarioActual(),
        cajero: cajero || null
      });
      return ref.id;
    } catch (e) {
      console.error('No se pudo guardar la tasación', e);
      return null;
    }
  }

  // =====================================================
  // 🌐 "Cotizá tu usado" en la web (se prende y apaga desde Gestiones → Tasador)
  // =====================================================

  /** ¿Los clientes ven "Cotizá tu usado"? (si falla la lectura, se toma como apagado) */
  async publicoHabilitado(): Promise<boolean> {
    try {
      const snap = await getDoc(doc(this.firestore, 'ConfiguracionTasador', 'publico'));
      return snap.exists() && (snap.data() as any).habilitado === true;
    } catch {
      return false;
    }
  }

  async cambiarPublico(habilitado: boolean): Promise<void> {
    await setDoc(doc(this.firestore, 'ConfiguracionTasador', 'publico'), {
      habilitado: habilitado === true,
      actualizado: serverTimestamp(),
      usuario: this.auditoria.getUsuarioActual()
    });
    this.auditoria.registrar({
      accion: 'modificar', entidad: 'Tasador', entidadId: 'publico',
      descripcion: habilitado ? 'Habilitó "Cotizá tu usado" para los clientes en la web' : 'Ocultó "Cotizá tu usado" de la web'
    });
  }

  /** Modelos activos (la consulta que pueden hacer los clientes cuando está habilitado) */
  async modelosPublicos(): Promise<ModeloTasador[]> {
    const snap = await getDocs(query(collection(this.firestore, 'Tasador'), where('activo', '==', true)));
    return snap.docs
      .map(d => ({ id: d.id, ...(d.data() as any) }) as ModeloTasador)
      .sort((a, b) => (Number(a.orden) || 0) - (Number(b.orden) || 0) ||
        String(a.nombre).localeCompare(String(b.nombre), 'es', { numeric: true }));
  }

  /** Tasación hecha por un cliente en la web (para saber qué consultan). No frena nada si falla. */
  async registrarWeb(r: ResultadoTasacion): Promise<void> {
    try {
      await setDoc(doc(collection(this.firestore, 'Tasaciones')), {
        modeloId: r.modeloId, modelo: r.modelo, capacidad: r.capacidad, precioBase: r.precioBase,
        respuestas: r.respuestas, descuentos: r.descuentos, totalUSD: r.totalUSD,
        cotizacion: null, totalARS: null,
        fecha: new Date().toISOString(), origen: 'web', usuario: null, cajero: null
      });
    } catch (e) {
      console.warn('No se pudo registrar la cotización web', e);
    }
  }

  /** Últimas tasaciones (más nuevas primero) */
  async ultimas(cantidad = 50): Promise<Tasacion[]> {
    const snap = await getDocs(query(collection(this.firestore, 'Tasaciones'), orderBy('fecha', 'desc'), limit(cantidad)));
    return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }) as Tasacion);
  }
}
