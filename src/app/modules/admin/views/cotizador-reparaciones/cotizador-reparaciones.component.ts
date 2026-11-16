import { Component, OnInit } from '@angular/core';
import Swal from 'sweetalert2';
import { take } from 'rxjs/operators';
import {
  CotizadorReparacionesService, CotizadorReparacionesError, CotizacionReparacionGuardada
} from '../../services/cotizador-reparaciones.service';
import {
  CotizacionReparacion, ModeloReparacion, PlantillaReparaciones, RepuestoVinculado, TipoPrecioReparacion,
  MAX_REPUESTOS_POR_RUBRO, MAX_RUBROS_REPARACION, idReparacion, modeloReparacionVacio, nombreProducto, precioRepuesto,
  productosDelModelo, repuestosDe, stockRepuesto, textoPesos, textoReparaciones, validarModeloReparacion, validarPlantilla
} from 'src/app/shared/utils/cotizador-reparaciones';
import { normalizarTexto as normalizar } from 'src/app/shared/utils/busqueda';
import { InfoEmpresaService } from 'src/app/shared/services/info-empresa.service';

/**
 * 🔧 Gestiones → Cotizador de reparaciones.
 *  - Plantilla: rubros (Pantalla, Batería…), iguales para todos los modelos.
 *  - Modelos: por rubro, los repuestos de nuestro stock que le sirven (precio y stock salen del producto).
 */
@Component({
  selector: 'app-cotizador-reparaciones',
  templateUrl: './cotizador-reparaciones.component.html',
  styleUrls: ['./cotizador-reparaciones.component.css']
})
export class CotizadorReparacionesComponent implements OnInit {

  plantilla: PlantillaReparaciones | null = null;
  modelos: ModeloReparacion[] = [];
  cargando = false;
  error = '';
  filtro = '';

  // Plantilla
  editandoPlantilla: PlantillaReparaciones | null = null;
  errorPlantilla = '';
  guardandoPlantilla = false;

  // Modelo
  editando: ModeloReparacion | null = null;
  repuestos: { [rubroId: string]: RepuestoVinculado[] } = {};
  buscarRepuesto: { [rubroId: string]: string } = {};
  errorEdicion = '';

  // Stock (para vincular y para ver precios / stock en las tarjetas)
  stock: any[] = [];
  stockPorId: { [id: string]: any } = {};
  cargandoStock = false;
  tipoPrecio: TipoPrecioReparacion = 'minorista';      // con qué lista se prueba / se muestran precios
  guardando = false;

  // Probar
  probando = false;
  dolar = 0;

  // Web
  publico = false;
  cambiandoPublico = false;

  // Historial
  historial: CotizacionReparacionGuardada[] = [];
  mostrarHistorial = false;
  cargandoHistorial = false;

  importando = false;

  readonly textoPesos = textoPesos;
  readonly textoReparaciones = textoReparaciones;
  readonly nombreProducto = nombreProducto;
  readonly stockRepuesto = stockRepuesto;
  readonly maxRubros = MAX_RUBROS_REPARACION;
  readonly maxRepuestos = MAX_REPUESTOS_POR_RUBRO;

  constructor(private cotizador: CotizadorReparacionesService, private infoEmpresa: InfoEmpresaService) { }

  ngOnInit(): void {
    this.cargar();
    this.cotizador.publicoHabilitado().then(h => this.publico = h);
    this.infoEmpresa.obtenerInfoGeneral().pipe(take(1)).subscribe((info: any) => this.dolar = Number(info?.dolar) || 0);
  }

  async cargar() {
    this.cargando = true;
    this.error = '';
    try {
      const [plantilla, modelos] = await Promise.all([this.cotizador.plantilla(), this.cotizador.modelos()]);
      this.plantilla = plantilla;
      this.modelos = modelos;
      if (!this.stock.length) await this.cargarStock();
    } catch (e: any) {
      console.error('Error cargando el cotizador de reparaciones', e);
      this.error = 'No se pudo cargar el cotizador. ' + (e?.message || '');
    } finally {
      this.cargando = false;
    }
  }

  get visibles(): ModeloReparacion[] {
    const t = this.filtro.trim().toLowerCase();
    return t ? this.modelos.filter(m => m.nombre.toLowerCase().includes(t)) : this.modelos;
  }

  /** Lee todo el stock (precios y stock actualizados) */
  async cargarStock() {
    this.cargandoStock = true;
    try {
      this.stock = await this.cotizador.todosLosProductos();
      this.stockPorId = Object.fromEntries(this.stock.map(p => [p.id, p]));
    } finally {
      this.cargandoStock = false;
    }
  }

  /** Activos con al menos un repuesto vinculado */
  get activos(): ModeloReparacion[] {
    return this.modelos.filter(m => m.activo !== false && productosDelModelo(m).length > 0);
  }

  /** Resumen de la tarjeta: cuántos repuestos y cuántos con stock */
  resumen(m: ModeloReparacion): string {
    const ids = productosDelModelo(m);
    if (!ids.length) return 'Sin repuestos vinculados';
    const conStock = ids.filter(id => stockRepuesto(this.stockPorId[id]) > 0).length;
    return `${ids.length} repuesto${ids.length === 1 ? '' : 's'} · ${conStock} con stock`;
  }

  /** Rubros del modelo con sus repuestos (para la tarjeta) */
  rubrosDe(m: ModeloReparacion): { nombre: string; repuestos: { texto: string; precio: number; stock: number; existe: boolean }[] }[] {
    return (this.plantilla?.rubros || [])
      .map(r => ({
        nombre: r.nombre,
        repuestos: repuestosDe(m, r.id).map(v => {
          const p = this.stockPorId[v.productoId];
          return { texto: v.etiqueta || nombreProducto(p), precio: precioRepuesto(p, this.tipoPrecio, this.dolar), stock: stockRepuesto(p), existe: !!p };
        })
      }))
      .filter(r => r.repuestos.length > 0);
  }

  // =====================================================
  // PLANTILLA
  // =====================================================

  abrirPlantilla() {
    if (this.editandoPlantilla) { this.editandoPlantilla = null; return; }
    this.editando = null;
    this.probando = false;
    this.editandoPlantilla = JSON.parse(JSON.stringify(this.plantilla || { rubros: [] }));
    this.errorPlantilla = '';
  }

  agregarRubro() {
    const p = this.editandoPlantilla;
    if (!p || p.rubros.length >= MAX_RUBROS_REPARACION) return;
    p.rubros.push({ id: idReparacion(), nombre: '' });
  }

  quitarRubro(i: number) {
    this.editandoPlantilla?.rubros.splice(i, 1);
  }

  moverRubro(i: number, d: -1 | 1) {
    const l = this.editandoPlantilla?.rubros;
    if (!l) return;
    const j = i + d;
    if (j < 0 || j >= l.length) return;
    [l[i], l[j]] = [l[j], l[i]];
  }

  trackId(_: number, x: { id: string }) {
    return x.id;
  }

  async guardarPlantilla() {
    if (!this.editandoPlantilla || this.guardandoPlantilla) return;
    const v = validarPlantilla(this.editandoPlantilla);
    if (!v.plantilla) { this.errorPlantilla = v.error || 'Revisá la plantilla.'; return; }
    // ¿Se borra un rubro que tiene repuestos vinculados?
    const ids = new Set(v.plantilla.rubros.map(r => r.id));
    const afectados = this.modelos.filter(m => Object.entries(m.repuestos || {}).some(([rid, l]) => !ids.has(rid) && Array.isArray(l) && l.length > 0));
    if (afectados.length) {
      const r = await Swal.fire({
        title: '¿Guardar la plantilla?',
        html: `Sacaste rubros que tienen repuestos vinculados en <strong>${afectados.length} modelo(s)</strong>. Esos repuestos dejan de ofrecerse.`,
        icon: 'warning', showCancelButton: true, confirmButtonText: 'Guardar', cancelButtonText: 'Revisar'
      });
      if (!r.isConfirmed) return;
    }
    this.guardandoPlantilla = true;
    this.errorPlantilla = '';
    try {
      this.plantilla = await this.cotizador.guardarPlantilla(this.editandoPlantilla);
      this.editandoPlantilla = null;
      Swal.fire({ title: 'Plantilla guardada', icon: 'success', timer: 1400, showConfirmButton: false });
    } catch (e: any) {
      this.errorPlantilla = e instanceof CotizadorReparacionesError ? e.message : 'No se pudo guardar. ' + (e?.message || '');
    } finally {
      this.guardandoPlantilla = false;
    }
  }

  // =====================================================
  // MODELOS
  // =====================================================

  private prepararRepuestos(m: ModeloReparacion) {
    const r: { [rubroId: string]: RepuestoVinculado[] } = {};
    for (const rubro of this.plantilla?.rubros || []) r[rubro.id] = repuestosDe(m, rubro.id).map(x => ({ ...x }));
    this.repuestos = r;
    this.buscarRepuesto = {};
  }

  /** Productos del stock que coinciden con lo buscado en el rubro (los ya vinculados no) */
  resultadosBusqueda(rubroId: string): any[] {
    const t = normalizar(this.buscarRepuesto[rubroId] || '');
    if (t.length < 2) return [];
    const palabras = t.split(' ').filter(Boolean);
    const ya = new Set((this.repuestos[rubroId] || []).map(x => x.productoId));
    return this.stock
      .filter(p => !ya.has(p.id))
      .filter(p => {
        const texto = normalizar([p.nombre, p.descripcion, p.modelo, p.color, p.codigoBarras].filter(Boolean).join(' '));
        return palabras.every(w => texto.includes(w));
      })
      .slice(0, 12);
  }

  vincular(rubroId: string, p: any) {
    const l = this.repuestos[rubroId] || (this.repuestos[rubroId] = []);
    if (l.length >= MAX_REPUESTOS_POR_RUBRO || l.some(x => x.productoId === p.id)) return;
    l.push({ productoId: p.id, etiqueta: '' });
    this.buscarRepuesto[rubroId] = '';
    this.errorEdicion = '';
  }

  desvincular(rubroId: string, i: number) {
    this.repuestos[rubroId]?.splice(i, 1);
  }

  moverRepuesto(rubroId: string, i: number, d: -1 | 1) {
    const l = this.repuestos[rubroId];
    if (!l) return;
    const j = i + d;
    if (j < 0 || j >= l.length) return;
    [l[i], l[j]] = [l[j], l[i]];
  }

  precioDe(productoId: string, tipo: TipoPrecioReparacion): number {
    return precioRepuesto(this.stockPorId[productoId], tipo, this.dolar);
  }

  nuevo() {
    this.cargarStock().catch(e => console.warn('No se pudo actualizar el stock', e));   // precios y stock de ahora
    this.probando = false;
    this.editandoPlantilla = null;
    this.editando = modeloReparacionVacio();
    this.prepararRepuestos(this.editando);
    this.errorEdicion = '';
    window.scrollTo({ top: 0 });
  }

  editar(m: ModeloReparacion) {
    this.cargarStock().catch(e => console.warn('No se pudo actualizar el stock', e));   // precios y stock de ahora
    this.probando = false;
    this.editandoPlantilla = null;
    this.editando = { ...m, repuestos: { ...(m.repuestos || {}) } };
    this.prepararRepuestos(m);
    this.errorEdicion = '';
    window.scrollTo({ top: 0 });
  }

  duplicar(m: ModeloReparacion) {
    this.editar(m);
    this.editando!.id = undefined;
    this.editando!.nombre = m.nombre + ' (copia)';
  }

  cancelarEdicion() {
    this.editando = null;
  }

  async guardar() {
    if (!this.editando || this.guardando || !this.plantilla) return;
    const m: ModeloReparacion = { ...this.editando, repuestos: this.repuestos };
    const v = validarModeloReparacion(m, this.plantilla);
    if (!v.modelo) { this.errorEdicion = v.error || 'Revisá los datos.'; return; }
    this.guardando = true;
    this.errorEdicion = '';
    try {
      await this.cotizador.guardar(m, this.plantilla);
      this.editando = null;
      await this.cargar();
      Swal.fire({ title: 'Modelo guardado', icon: 'success', timer: 1400, showConfirmButton: false });
    } catch (e: any) {
      this.errorEdicion = e instanceof CotizadorReparacionesError ? e.message : 'No se pudo guardar. ' + (e?.message || '');
    } finally {
      this.guardando = false;
    }
  }

  async eliminar(m: ModeloReparacion) {
    const r = await Swal.fire({
      title: `¿Eliminar "${m.nombre}"?`,
      text: 'Se borra el modelo con sus repuestos vinculados (los productos del stock no se tocan). Si solo querés que no aparezca, desactivalo.',
      icon: 'warning', showCancelButton: true, confirmButtonText: 'Eliminar', cancelButtonText: 'Cancelar', confirmButtonColor: '#d33'
    });
    if (!r.isConfirmed) return;
    try {
      await this.cotizador.eliminar(m);
      if (this.editando?.id === m.id) this.editando = null;
      await this.cargar();
    } catch (e: any) {
      Swal.fire('No se pudo eliminar', e?.message || '', 'error');
    }
  }

  async alternarActivo(m: ModeloReparacion) {
    if (!this.plantilla) return;
    try {
      await this.cotizador.guardar({ ...m, activo: m.activo === false }, this.plantilla);
      await this.cargar();
    } catch (e: any) {
      Swal.fire('No se pudo cambiar', e instanceof CotizadorReparacionesError ? e.message : (e?.message || ''), 'warning');
    }
  }

  async importar() {
    if (this.importando) return;
    const r = await Swal.fire({
      title: '¿Traer los modelos del tasador?',
      text: 'Se agregan los nombres que todavía no están, sin repuestos e inactivos. Después les vinculás los repuestos.',
      icon: 'question', showCancelButton: true, confirmButtonText: 'Traer', cancelButtonText: 'Cancelar'
    });
    if (!r.isConfirmed) return;
    this.importando = true;
    try {
      const n = await this.cotizador.importarDelTasador();
      await this.cargar();
      Swal.fire(n ? `Se agregaron ${n} modelo(s)` : 'No había modelos nuevos', n ? 'Quedaron inactivos: vinculales los repuestos y activalos.' : '', 'success');
    } catch (e: any) {
      Swal.fire('No se pudo importar', e?.message || '', 'error');
    } finally {
      this.importando = false;
    }
  }

  // =====================================================
  // 🌐 WEB · PROBAR · HISTORIAL
  // =====================================================

  async alternarPublico() {
    if (this.cambiandoPublico) return;
    const habilitar = !this.publico;
    if (habilitar && !this.activos.length) {
      Swal.fire('Primero cargá modelos', 'Para mostrarlo a los clientes tiene que haber al menos un modelo activo con repuestos vinculados.', 'info');
      return;
    }
    const r = await Swal.fire({
      title: habilitar ? '¿Mostrar "Cotizá tu reparación" a los clientes?' : '¿Ocultar "Cotizá tu reparación"?',
      html: habilitar
        ? `Aparece en el menú de la tienda y cualquiera puede cotizar con los <strong>${this.activos.length} modelo(s) activo(s)</strong>.<br><small>Ven los precios de los repuestos con stock (en pesos), con el aviso de que falta la mano de obra.</small>`
        : 'Los clientes dejan de verlo. Vos lo podés seguir viendo como vista previa.',
      icon: 'question', showCancelButton: true, confirmButtonText: habilitar ? 'Sí, mostrar' : 'Sí, ocultar', cancelButtonText: 'Cancelar'
    });
    if (!r.isConfirmed) return;
    this.cambiandoPublico = true;
    try {
      await this.cotizador.cambiarPublico(habilitar);
      this.publico = habilitar;
    } catch (e: any) {
      Swal.fire('No se pudo cambiar', e?.message || '', 'error');
    } finally {
      this.cambiandoPublico = false;
    }
  }

  probar() {
    this.editando = null;
    this.editandoPlantilla = null;
    this.probando = !this.probando;
  }

  async alProbar(r: CotizacionReparacion) {
    this.probando = false;
    await this.cotizador.registrar(r, 'gestiones');
    Swal.fire({
      title: textoPesos(r.total),
      html: `${r.modelo} · precio ${r.tipoPrecio}<br><small>${r.items.map(i => `${i.rubro} (${i.etiqueta}): ${textoPesos(i.precio)}`).join('<br>')}` +
        (r.descuento > 0 ? `<br>Descuento: −${textoPesos(r.descuento)}` : '') + '</small><br><small class="text-muted">Falta sumar la mano de obra.</small>',
      icon: 'info'
    });
    if (this.mostrarHistorial) this.verHistorial(true);
  }

  async verHistorial(forzar = false) {
    if (this.mostrarHistorial && !forzar) { this.mostrarHistorial = false; return; }
    this.mostrarHistorial = true;
    this.cargandoHistorial = true;
    try {
      this.historial = await this.cotizador.ultimas(50);
    } catch (e) {
      console.error('Error leyendo cotizaciones de reparación', e);
      this.historial = [];
    } finally {
      this.cargandoHistorial = false;
    }
  }
}
