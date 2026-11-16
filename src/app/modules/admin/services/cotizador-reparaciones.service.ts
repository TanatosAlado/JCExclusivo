import { Injectable } from '@angular/core';
import {
  Firestore, collection, deleteDoc, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, setDoc, where
} from '@angular/fire/firestore';
import { AuditoriaService } from 'src/app/shared/services/auditoria.service';
import {
  CotizacionReparacion, ModeloReparacion, PlantillaReparaciones, plantillaInicial, validarModeloReparacion, validarPlantilla
} from 'src/app/shared/utils/cotizador-reparaciones';

export class CotizadorReparacionesError extends Error { }

/** Una cotización guardada (historial) */
export interface CotizacionReparacionGuardada extends CotizacionReparacion {
  id: string;
  fecha: string;
  origen: 'despacho' | 'gestiones' | 'web';
  usuario: any;
  cajero?: any;
  ordenGenerada?: boolean;
}

/**
 * 🔧 Cotizador de reparaciones.
 *  - ConfiguracionReparaciones/plantilla: rubros y calidades (una sola para todos los modelos).
 *  - ConfiguracionReparaciones/publico: si los clientes ven "Cotizá tu reparación".
 *  - ModelosReparacion/{id}: por rubro, los repuestos del stock (productos) que le sirven a cada modelo.
 *  - Los precios y el stock salen de los productos (colección 'productos').
 *  - CotizacionesReparacion/{id}: historial de cotizaciones.
 */
@Injectable({ providedIn: 'root' })
export class CotizadorReparacionesService {

  constructor(private firestore: Firestore, private auditoria: AuditoriaService) { }

  // =====================================================
  // PLANTILLA (rubros)
  // =====================================================

  /** La plantilla guardada (o la inicial, si todavía no se guardó ninguna) */
  async plantilla(): Promise<PlantillaReparaciones> {
    const snap = await getDoc(doc(this.firestore, 'ConfiguracionReparaciones', 'plantilla'));
    const data: any = snap.exists() ? snap.data() : null;
    return Array.isArray(data?.rubros) && data.rubros.length
      ? { rubros: data.rubros.map((r: any) => ({ id: String(r.id), nombre: String(r.nombre || '') })) }
      : plantillaInicial();
  }

  async guardarPlantilla(p: PlantillaReparaciones): Promise<PlantillaReparaciones> {
    const v = validarPlantilla(p);
    if (!v.plantilla) throw new CotizadorReparacionesError(v.error || 'Revisá la plantilla.');
    await setDoc(doc(this.firestore, 'ConfiguracionReparaciones', 'plantilla'), {
      rubros: v.plantilla.rubros,
      actualizado: serverTimestamp(),
      usuario: this.auditoria.getUsuarioActual()
    });
    this.auditoria.registrar({
      accion: 'modificar', entidad: 'CotizadorReparaciones', entidadId: 'plantilla',
      descripcion: 'Modificó la plantilla del cotizador de reparaciones: ' +
        v.plantilla.rubros.map(r => r.nombre).join(' · ')
    });
    return v.plantilla;
  }

  // =====================================================
  // MODELOS
  // =====================================================

  async modelos(soloActivos = false): Promise<ModeloReparacion[]> {
    const snap = await getDocs(collection(this.firestore, 'ModelosReparacion'));
    return this.ordenar(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }) as ModeloReparacion)
      .filter(m => !soloActivos || m.activo !== false));
  }

  private ordenar(lista: ModeloReparacion[]): ModeloReparacion[] {
    return lista.sort((a, b) => (Number(a.orden) || 0) - (Number(b.orden) || 0) ||
      String(a.nombre).localeCompare(String(b.nombre), 'es', { numeric: true }));
  }

  /** Crea o actualiza un modelo. Devuelve el id. */
  async guardar(m: ModeloReparacion, plantilla: PlantillaReparaciones): Promise<string> {
    const v = validarModeloReparacion(m, plantilla);
    if (!v.modelo) throw new CotizadorReparacionesError(v.error || 'Revisá los datos.');
    const nuevo = !m.id;
    const ref = m.id ? doc(this.firestore, 'ModelosReparacion', m.id) : doc(collection(this.firestore, 'ModelosReparacion'));
    const { id, ...datos } = v.modelo as any;
    await setDoc(ref, { ...datos, actualizado: serverTimestamp() });
    const cantidad = Object.values(datos.repuestos as any).reduce((a: number, x: any) => a + (Array.isArray(x) ? x.length : 0), 0);
    this.auditoria.registrar({
      accion: nuevo ? 'crear' : 'modificar',
      entidad: 'CotizadorReparaciones',
      entidadId: ref.id,
      descripcion: `${nuevo ? 'Agregó' : 'Modificó'} el modelo "${datos.nombre}" del cotizador de reparaciones (${cantidad} repuesto(s) vinculado(s))` +
        (datos.activo ? '' : ' · inactivo')
    });
    return ref.id;
  }

  async eliminar(m: ModeloReparacion): Promise<void> {
    if (!m?.id) return;
    await deleteDoc(doc(this.firestore, 'ModelosReparacion', m.id));
    this.auditoria.registrar({
      accion: 'eliminar', entidad: 'CotizadorReparaciones', entidadId: m.id,
      descripcion: `Eliminó el modelo "${m.nombre}" del cotizador de reparaciones`
    });
  }

  /**
   * Trae los nombres de los modelos del tasador que todavía no están (sin repuestos: se vinculan a mano).
   * Quedan inactivos hasta que les vincules repuestos. Devuelve cuántos agregó.
   */
  async importarDelTasador(): Promise<number> {
    const [tasador, actuales] = await Promise.all([getDocs(collection(this.firestore, 'Tasador')), this.modelos()]);
    const existentes = new Set(actuales.map(m => String(m.nombre).trim().toLowerCase()));
    const nombres = [...new Set(tasador.docs.map(d => String((d.data() as any)?.nombre || '').trim()).filter(Boolean))]
      .filter(n => !existentes.has(n.toLowerCase()));
    for (const nombre of nombres) {
      await setDoc(doc(collection(this.firestore, 'ModelosReparacion')), {
        nombre, activo: false, repuestos: {}, orden: 0, actualizado: serverTimestamp()
      });
    }
    if (nombres.length) {
      this.auditoria.registrar({
        accion: 'crear', entidad: 'CotizadorReparaciones', entidadId: 'importacion',
        descripcion: `Importó ${nombres.length} modelo(s) del tasador al cotizador de reparaciones`
      });
    }
    return nombres.length;
  }

  // =====================================================
  // PRODUCTOS DEL STOCK (precios y stock al momento)
  // =====================================================

  /** Productos por id, leídos al momento (precio y stock actualizados). Los que no existen no vienen. */
  async productos(ids: string[]): Promise<{ [id: string]: any }> {
    const unicos = [...new Set((ids || []).filter(Boolean))];
    const snaps = await Promise.all(unicos.map(id => getDoc(doc(this.firestore, 'productos', id)).catch(() => null)));
    const out: { [id: string]: any } = {};
    snaps.forEach((s, i) => { if (s && s.exists()) out[unicos[i]] = { id: unicos[i], ...(s.data() as any) }; });
    return out;
  }

  /** Todo el stock (para buscar y vincular repuestos desde Gestiones) */
  async todosLosProductos(): Promise<any[]> {
    const snap = await getDocs(collection(this.firestore, 'productos'));
    return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
  }

  // =====================================================
  // HISTORIAL
  // =====================================================

  /** Guarda la cotización (no frena nada si falla) */
  async registrar(r: CotizacionReparacion, origen: 'despacho' | 'gestiones', cajero: any = null, ordenGenerada = false): Promise<string | null> {
    try {
      const ref = doc(collection(this.firestore, 'CotizacionesReparacion'));
      await setDoc(ref, {
        ...r,
        fecha: new Date().toISOString(),
        origen,
        usuario: this.auditoria.getUsuarioActual(),
        cajero: cajero || null,
        ordenGenerada
      });
      return ref.id;
    } catch (e) {
      console.error('No se pudo guardar la cotización de reparación', e);
      return null;
    }
  }

  async ultimas(cantidad = 50): Promise<CotizacionReparacionGuardada[]> {
    const snap = await getDocs(query(collection(this.firestore, 'CotizacionesReparacion'), orderBy('fecha', 'desc'), limit(cantidad)));
    return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }) as CotizacionReparacionGuardada);
  }

  // =====================================================
  // 🌐 "Cotizá tu reparación" en la web
  // =====================================================

  async publicoHabilitado(): Promise<boolean> {
    try {
      const snap = await getDoc(doc(this.firestore, 'ConfiguracionReparaciones', 'publico'));
      return snap.exists() && (snap.data() as any).habilitado === true;
    } catch {
      return false;
    }
  }

  async cambiarPublico(habilitado: boolean): Promise<void> {
    await setDoc(doc(this.firestore, 'ConfiguracionReparaciones', 'publico'), {
      habilitado: habilitado === true,
      actualizado: serverTimestamp(),
      usuario: this.auditoria.getUsuarioActual()
    });
    this.auditoria.registrar({
      accion: 'modificar', entidad: 'CotizadorReparaciones', entidadId: 'publico',
      descripcion: habilitado ? 'Habilitó "Cotizá tu reparación" para los clientes en la web' : 'Ocultó "Cotizá tu reparación" de la web'
    });
  }

  /** Modelos activos (la consulta que pueden hacer los clientes cuando está habilitado) */
  async modelosPublicos(): Promise<ModeloReparacion[]> {
    const snap = await getDocs(query(collection(this.firestore, 'ModelosReparacion'), where('activo', '==', true)));
    return this.ordenar(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }) as ModeloReparacion));
  }

  /** Cotización hecha por un cliente en la web (para saber qué consultan). No frena nada si falla. */
  async registrarWeb(r: CotizacionReparacion): Promise<void> {
    try {
      await setDoc(doc(collection(this.firestore, 'CotizacionesReparacion')), {
        modeloId: r.modeloId, modelo: r.modelo, tipoPrecio: r.tipoPrecio === 'mayorista' ? 'mayorista' : 'minorista', items: r.items,
        subtotal: r.subtotal, descuento: 0, total: r.subtotal, dolar: r.dolar ?? null,
        fecha: new Date().toISOString(), origen: 'web', usuario: null, cajero: null
      });
    } catch (e) {
      console.warn('No se pudo registrar la cotización web de reparación', e);
    }
  }
}
