import { Component, OnInit } from '@angular/core';
import Swal from 'sweetalert2';
import { TasadorService, TasadorError, Tasacion } from '../../services/tasador.service';
import { CAPACIDADES } from '../../services/equipos.service';
import {
  ModeloTasador, PreguntaTasador, ResultadoTasacion, idPregunta, modeloVacio, textoUSD, validarModelo,
  MAX_PREGUNTAS_TASADOR, MAX_CAPACIDADES_TASADOR
} from 'src/app/shared/utils/tasador';
import { InfoEmpresaService } from 'src/app/shared/services/info-empresa.service';
import { take } from 'rxjs/operators';
import { cotizacionEquipos } from 'src/app/shared/utils/equipos-tienda';

/**
 * 🧮 Gestiones → Tasador: modelos (precio en USD por capacidad) y sus preguntas Sí/No con descuento fijo.
 * Se usa en Despacho para tasar el equipo del Plan canje.
 */
@Component({
  selector: 'app-tasador',
  templateUrl: './tasador.component.html',
  styleUrls: ['./tasador.component.css']
})
export class TasadorComponent implements OnInit {

  modelos: ModeloTasador[] = [];
  cargando = false;
  error = '';
  filtro = '';

  // Edición
  editando: ModeloTasador | null = null;
  errorEdicion = '';
  guardando = false;

  // Probar tasación
  probando = false;
  cotizacion = 0;

  // 🌐 "Cotizá tu usado" en la web
  publico = false;
  cambiandoPublico = false;

  // Historial
  historial: Tasacion[] = [];
  mostrarHistorial = false;
  cargandoHistorial = false;

  readonly capacidades = CAPACIDADES;
  readonly textoUSD = textoUSD;
  readonly maxPreguntas = MAX_PREGUNTAS_TASADOR;
  readonly maxCapacidades = MAX_CAPACIDADES_TASADOR;

  constructor(private tasador: TasadorService, private infoEmpresa: InfoEmpresaService) { }

  ngOnInit(): void {
    this.cargar();
    this.tasador.publicoHabilitado().then(h => this.publico = h);
    this.infoEmpresa.obtenerInfoGeneral().pipe(take(1)).subscribe((info: any) => this.cotizacion = info ? cotizacionEquipos(info) || 0 : 0);
  }

  async cargar() {
    this.cargando = true;
    this.error = '';
    try {
      this.modelos = await this.tasador.modelos();
    } catch (e: any) {
      console.error('Error cargando el tasador', e);
      this.error = 'No se pudieron cargar los modelos. ' + (e?.message || '');
    } finally {
      this.cargando = false;
    }
  }

  get visibles(): ModeloTasador[] {
    const t = this.filtro.trim().toLowerCase();
    return t ? this.modelos.filter(m => m.nombre.toLowerCase().includes(t)) : this.modelos;
  }

  get activos(): ModeloTasador[] {
    return this.modelos.filter(m => m.activo !== false);
  }

  rango(m: ModeloTasador): string {
    const precios = (m.capacidades || []).map(c => c.precio);
    if (!precios.length) return '—';
    const min = Math.min(...precios), max = Math.max(...precios);
    return min === max ? textoUSD(min) : `${textoUSD(min)} a ${textoUSD(max)}`;
  }

  // =====================================================
  // EDICIÓN
  // =====================================================

  nuevo() {
    this.probando = false;
    this.editando = modeloVacio();
    this.errorEdicion = '';
    window.scrollTo({ top: 0 });
  }

  editar(m: ModeloTasador) {
    this.probando = false;
    this.editando = JSON.parse(JSON.stringify({ ...m, actualizado: null }));
    if (!this.editando!.capacidades.length) this.editando!.capacidades.push({ capacidad: '', precio: null as any });
    this.errorEdicion = '';
    window.scrollTo({ top: 0 });
  }

  /** Copia un modelo (para cargar rápido uno parecido) */
  duplicar(m: ModeloTasador) {
    this.editar(m);
    this.editando!.id = undefined;
    this.editando!.nombre = m.nombre + ' (copia)';
    this.editando!.preguntas = this.editando!.preguntas.map(p => ({ ...p, id: idPregunta() }));
  }

  cancelarEdicion() {
    this.editando = null;
  }

  agregarCapacidad() {
    if (!this.editando || this.editando.capacidades.length >= MAX_CAPACIDADES_TASADOR) return;
    const usadas = this.editando.capacidades.map(c => c.capacidad);
    this.editando.capacidades.push({ capacidad: CAPACIDADES.find(c => !usadas.includes(c)) || '', precio: null as any });
  }

  quitarCapacidad(i: number) {
    this.editando?.capacidades.splice(i, 1);
  }

  agregarPregunta() {
    if (!this.editando || this.editando.preguntas.length >= MAX_PREGUNTAS_TASADOR) return;
    this.editando.preguntas.push({ id: idPregunta(), texto: '', descuentaSi: 'no', descuento: null as any });
  }

  quitarPregunta(i: number) {
    this.editando?.preguntas.splice(i, 1);
  }

  moverPregunta(i: number, d: -1 | 1) {
    const l = this.editando?.preguntas;
    if (!l) return;
    const j = i + d;
    if (j < 0 || j >= l.length) return;
    [l[i], l[j]] = [l[j], l[i]];
  }

  trackPregunta(_: number, p: PreguntaTasador) {
    return p.id;
  }

  async guardar() {
    if (!this.editando || this.guardando) return;
    const v = validarModelo(this.editando);
    if (!v.modelo) { this.errorEdicion = v.error || 'Revisá los datos.'; return; }
    this.guardando = true;
    this.errorEdicion = '';
    try {
      await this.tasador.guardar(this.editando);
      this.editando = null;
      await this.cargar();
      Swal.fire({ title: 'Modelo guardado', icon: 'success', timer: 1400, showConfirmButton: false });
    } catch (e: any) {
      this.errorEdicion = e instanceof TasadorError ? e.message : 'No se pudo guardar. ' + (e?.message || '');
      if (!(e instanceof TasadorError)) console.error('Error guardando modelo del tasador', e);
    } finally {
      this.guardando = false;
    }
  }

  async eliminar(m: ModeloTasador) {
    const r = await Swal.fire({
      title: `¿Eliminar "${m.nombre}"?`,
      text: 'Se borra el modelo con sus precios y preguntas. Si solo querés que no aparezca, desactivalo.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Eliminar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#d33'
    });
    if (!r.isConfirmed) return;
    try {
      await this.tasador.eliminar(m);
      if (this.editando?.id === m.id) this.editando = null;
      await this.cargar();
    } catch (e: any) {
      Swal.fire('No se pudo eliminar', e?.message || '', 'error');
    }
  }

  async alternarActivo(m: ModeloTasador) {
    try {
      await this.tasador.guardar({ ...m, activo: m.activo === false });
      await this.cargar();
    } catch (e: any) {
      Swal.fire('No se pudo cambiar', e instanceof TasadorError ? e.message : (e?.message || ''), 'warning');
    }
  }

  // =====================================================
  // 🌐 COTIZÁ TU USADO (web)
  // =====================================================

  async alternarPublico() {
    if (this.cambiandoPublico) return;
    const habilitar = !this.publico;
    if (habilitar && !this.activos.length) {
      Swal.fire('Primero cargá modelos', 'Para mostrarlo a los clientes tiene que haber al menos un modelo activo.', 'info');
      return;
    }
    const r = await Swal.fire({
      title: habilitar ? '¿Mostrar "Cotizá tu usado" a los clientes?' : '¿Ocultar "Cotizá tu usado"?',
      html: habilitar
        ? `Aparece en el menú de la tienda y cualquiera puede cotizar con los <strong>${this.activos.length} modelo(s) activo(s)</strong>.<br><small>Se ven los precios en USD de cada capacidad.</small>`
        : 'Los clientes dejan de verlo. Vos lo podés seguir viendo como vista previa.',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: habilitar ? 'Sí, mostrar' : 'Sí, ocultar',
      cancelButtonText: 'Cancelar'
    });
    if (!r.isConfirmed) return;
    this.cambiandoPublico = true;
    try {
      await this.tasador.cambiarPublico(habilitar);
      this.publico = habilitar;
    } catch (e: any) {
      Swal.fire('No se pudo cambiar', e?.message || '', 'error');
    } finally {
      this.cambiandoPublico = false;
    }
  }

  // =====================================================
  // PROBAR / HISTORIAL
  // =====================================================

  probar() {
    this.editando = null;
    this.probando = !this.probando;
  }

  async alProbar(r: ResultadoTasacion) {
    this.probando = false;
    await this.tasador.registrar(r, 'gestiones');
    Swal.fire({
      title: textoUSD(r.totalUSD),
      html: `${r.modelo} ${r.capacidad}` + (r.totalARS !== null ? `<br>${new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(r.totalARS)}` : '') +
        (r.respuestas.filter(x => x.descuento > 0).length
          ? `<br><small>${r.respuestas.filter(x => x.descuento > 0).map(x => `${x.pregunta}: ${x.respuesta === 'si' ? 'Sí' : 'No'} (−${textoUSD(x.descuento)})`).join('<br>')}</small>`
          : ''),
      icon: 'info'
    });
    if (this.mostrarHistorial) this.verHistorial(true);
  }

  async verHistorial(forzar = false) {
    if (this.mostrarHistorial && !forzar) { this.mostrarHistorial = false; return; }
    this.mostrarHistorial = true;
    this.cargandoHistorial = true;
    try {
      this.historial = await this.tasador.ultimas(50);
    } catch (e) {
      console.error('Error leyendo tasaciones', e);
      this.historial = [];
    } finally {
      this.cargandoHistorial = false;
    }
  }

  descuentosDe(t: Tasacion): string {
    return (t.respuestas || []).filter(r => r.descuento > 0).map(r => `${r.pregunta} (−${textoUSD(r.descuento)})`).join(' · ') || 'Sin descuentos';
  }
}
