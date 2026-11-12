import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import Swal from 'sweetalert2';
import * as XLSX from 'xlsx';
import {
  EquiposService, Equipo, DatosEquipo, EquipoError, EstadoEquipo,
  CAPACIDADES, GRADOS, MONEDAS, CONDICIONES, CondicionEquipo, validarEquipo, normalizarImei, imeiValido, nombreEquipo,
  condicionDe, nombreCondicion, fotosDe, MAX_FOTOS_EQUIPO, esEditable
} from '../../services/equipos.service';
import { InfoEmpresaService } from 'src/app/shared/services/info-empresa.service';
import { BuscadorClientesService } from 'src/app/shared/services/buscador-clientes.service';

/**
 * Gestiones → Equipos: alta, modificación y baja de equipos para la venta.
 * Cada equipo es una unidad única (IMEI). En esta etapa se cargan y gestionan;
 * la venta (Despacho y tienda) viene en las etapas siguientes.
 */
@Component({
  selector: 'app-equipos',
  templateUrl: './equipos.component.html',
  styleUrls: ['./equipos.component.css']
})
export class EquiposComponent implements OnInit, OnDestroy {

  readonly capacidades = CAPACIDADES;
  readonly grados = GRADOS;
  readonly monedas = MONEDAS;
  readonly condiciones = CONDICIONES;
  readonly condicionDe = condicionDe;
  readonly nombreCondicion = nombreCondicion;
  readonly nombreEquipo = nombreEquipo;
  readonly esEditable = esEditable;

  // Listado
  cargando = false;
  error = '';
  equipos: Equipo[] = [];
  filtro = '';
  filtroEstado: EstadoEquipo | 'todos' = 'disponible';
  filtroCondicion: CondicionEquipo | 'todas' = 'todas';
  orden: 'recientes' | 'modelo' | 'precio' = 'recientes';

  // Formulario (alta / edición)
  editando: Equipo | null = null;   // null + mostrarForm = alta
  mostrarForm = false;
  form: DatosEquipo = this.formVacio();
  erroresForm: string[] = [];
  guardando = false;
  subiendoFoto = false;
  /** Foto que se ve grande en el formulario */
  fotoSeleccionada = 0;
  readonly maxFotos = MAX_FOTOS_EQUIPO;
  readonly fotosDe = fotosDe;

  dolar = 0;
  private infoSub?: Subscription;

  constructor(
    private equiposService: EquiposService,
    private infoEmpresa: InfoEmpresaService
  ) { }

  ngOnInit() {
    this.cargar();
    this.infoSub = this.infoEmpresa.obtenerInfoGeneral().subscribe(info => {
      // Equivalente en pesos con el dólar JC (el que se usa para vender equipos)
      const jc = Number((info as any)?.dolarJC);
      this.dolar = jc > 0 ? jc : (Number(info?.dolar) || 0);
    });
  }

  ngOnDestroy() {
    this.infoSub?.unsubscribe();
  }

  async cargar() {
    this.cargando = true;
    this.error = '';
    try {
      this.equipos = await this.equiposService.listar();
    } catch (e: any) {
      console.error('Error cargando equipos', e);
      this.error = 'No se pudieron cargar los equipos. ' + (e?.message || '');
    } finally {
      this.cargando = false;
    }
  }

  // =====================================================
  // LISTADO
  // =====================================================

  get visibles(): Equipo[] {
    const palabras = BuscadorClientesService.normalizar(this.filtro).split(' ').filter(Boolean);
    const lista = this.equipos
      .filter(e => this.filtroEstado === 'todos' || e.estado === this.filtroEstado)
      .filter(e => this.filtroCondicion === 'todas' || condicionDe(e) === this.filtroCondicion)
      .filter(e => {
        if (!palabras.length) return true;
        const texto = BuscadorClientesService.normalizar(
          `${nombreCondicion(e)} ${e.modelo} ${e.color} ${e.capacidad} ${e.imei} ${e.grado} ${e.observaciones}`);
        return palabras.every(p => texto.includes(p));
      });
    if (this.orden === 'modelo') return lista.sort((a, b) => a.modelo.localeCompare(b.modelo, 'es', { numeric: true }));
    if (this.orden === 'precio') return lista.sort((a, b) => this.enPesos(b, b.precioMinorista) - this.enPesos(a, a.precioMinorista));
    return lista.sort((a, b) => String(b.creado?.fecha || '').localeCompare(String(a.creado?.fecha || '')));
  }

  get disponibles(): Equipo[] {
    return this.equipos.filter(e => e.estado === 'disponible');
  }

  /** Equipos que entraron por plan canje y falta publicar (foto y precios) */
  get cantidadEnPreparacion(): number {
    return this.equipos.filter(e => e.estado === 'preparacion').length;
  }

  /** "$ 250.000" (lo que se le tomó al cliente) */
  montoCanje(e: Equipo): string {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(Number(e.canje?.monto) || 0);
  }

  get cantidadVendidos(): number {
    return this.equipos.filter(e => e.estado === 'vendido').length;
  }

  /** Valor del stock disponible a precio minorista, separado por moneda */
  get valorStock(): { usd: number; ars: number; totalPesos: number } {
    let usd = 0, ars = 0;
    for (const e of this.disponibles) {
      if (e.moneda === 'ARS') ars += Number(e.precioMinorista) || 0;
      else usd += Number(e.precioMinorista) || 0;
    }
    return { usd, ars, totalPesos: ars + usd * (this.dolar || 0) };
  }

  get sinFoto(): number {
    return this.disponibles.filter(e => !fotosDe(e).length).length;
  }

  enPesos(e: Pick<Equipo, 'moneda'>, precio: number): number {
    return e.moneda === 'ARS' ? Number(precio) || 0 : (Number(precio) || 0) * (this.dolar || 0);
  }

  readonly monedaUsd: Pick<Equipo, 'moneda'> = { moneda: 'USD' };

  precio(e: Pick<Equipo, 'moneda'>, valor: number): string {
    const n = Number(valor) || 0;
    return e.moneda === 'ARS'
      ? new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)
      : 'US$ ' + n.toLocaleString('es-AR', { maximumFractionDigits: 2 });
  }

  claseBateria(b: number): string {
    const n = Number(b) || 0;
    return n >= 90 ? 'bien' : n >= 80 ? 'media' : 'baja';
  }

  // =====================================================
  // FORMULARIO
  // =====================================================

  private formVacio(): DatosEquipo {
    return {
      condicion: '' as any,   // obligatorio: se elige Nuevo o Usado
      modelo: '', color: '', capacidad: '', imei: '', bateria: null as any, grado: '',
      observaciones: '', precioMinorista: null as any, precioMayorista: null as any, moneda: 'USD', imagen: '', imagenes: []
    };
  }

  nuevo() {
    this.editando = null;
    this.form = this.formVacio();
    this.erroresForm = [];
    this.fotoSeleccionada = 0;
    this.mostrarForm = true;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  editar(e: Equipo) {
    if (!esEditable(e)) return;
    this.editando = e;
    this.form = {
      condicion: condicionDe(e),
      modelo: e.modelo, color: e.color, capacidad: e.capacidad, imei: e.imei, bateria: e.bateria,
      grado: e.grado, observaciones: e.observaciones || '', precioMinorista: e.precioMinorista,
      precioMayorista: e.precioMayorista, moneda: e.moneda || 'USD', imagen: e.imagen || '', imagenes: fotosDe(e)
    };
    this.erroresForm = [];
    this.fotoSeleccionada = 0;
    this.mostrarForm = true;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async cancelar() {
    if (this.guardando || this.subiendoFoto) return;
    if (this.hayCambios) {
      const r = await Swal.fire({
        title: '¿Descartar los cambios?',
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Descartar',
        cancelButtonText: 'Seguir editando'
      });
      if (!r.isConfirmed) return;
    }
    this.mostrarForm = false;
    this.editando = null;
  }

  private get hayCambios(): boolean {
    const base = this.editando ? {
      condicion: condicionDe(this.editando),
      modelo: this.editando.modelo, color: this.editando.color, capacidad: this.editando.capacidad,
      imei: this.editando.imei, bateria: this.editando.bateria, grado: this.editando.grado,
      observaciones: this.editando.observaciones || '', precioMinorista: this.editando.precioMinorista,
      precioMayorista: this.editando.precioMayorista, moneda: this.editando.moneda || 'USD', imagen: this.editando.imagen || '',
      imagenes: fotosDe(this.editando)
    } : this.formVacio();
    return (Object.keys(base) as (keyof DatosEquipo)[])
      .some(k => String(base[k] ?? '') !== String(this.form[k] ?? ''));
  }

  /** Nuevo / usado: un equipo nuevo no lleva grado y la batería arranca en 100% */
  elegirCondicion(c: CondicionEquipo) {
    this.form.condicion = c;
    if (c === 'nuevo') {
      this.form.grado = '';
      if (this.form.bateria === null || this.form.bateria === undefined || String(this.form.bateria) === '') {
        this.form.bateria = 100;
      }
    }
    this.erroresForm = [];
  }

  /** Aviso (no bloquea) si parece un IMEI de 15 dígitos pero no es válido */
  get avisoImei(): string {
    const imei = normalizarImei(this.form.imei);
    if (/^\d{15}$/.test(imei) && !imeiValido(imei)) return 'Este IMEI no parece válido: revisá los dígitos.';
    if (/^\d+$/.test(imei) && imei.length > 0 && imei.length !== 15 && imei.length >= 13) return 'Un IMEI tiene 15 dígitos.';
    return '';
  }

  /** Fotos cargadas en el formulario (la primera es la principal) */
  get fotos(): string[] {
    return this.form.imagenes || [];
  }

  get fotoGrande(): string {
    return this.fotos[this.fotoSeleccionada] || this.fotos[0] || '';
  }

  /** Sube una o varias fotos (hasta el máximo) */
  async onFoto(event: Event) {
    const input = event.target as HTMLInputElement;
    const archivos = Array.from(input?.files || []);
    if (!archivos.length) return;
    const lugar = this.maxFotos - this.fotos.length;
    if (lugar <= 0) {
      Swal.fire('Máximo de fotos', `Cada equipo puede tener hasta ${this.maxFotos} fotos.`, 'info');
      if (input) input.value = '';
      return;
    }
    const aSubir = archivos.slice(0, lugar);
    this.subiendoFoto = true;
    try {
      for (const file of aSubir) {
        const url = await this.equiposService.subirFoto(file);
        this.form.imagenes = [...this.fotos, url];
        this.form.imagen = this.fotos[0] || '';
      }
      this.fotoSeleccionada = this.fotos.length - 1;
      if (archivos.length > aSubir.length) {
        Swal.fire('Máximo de fotos', `Se subieron ${aSubir.length}: cada equipo puede tener hasta ${this.maxFotos} fotos.`, 'info');
      }
    } catch (e: any) {
      console.error('Error subiendo foto', e);
      Swal.fire('No se pudo subir la foto', e instanceof EquipoError ? e.message
        : e?.code === 'storage/unauthorized' ? 'No tenés permiso para subir fotos de equipos.'
          : 'Probá de nuevo. ' + (e?.message || ''), 'error');
    } finally {
      this.subiendoFoto = false;
      if (input) input.value = '';
    }
  }

  quitarFoto(i: number) {
    const fotos = [...this.fotos];
    fotos.splice(i, 1);
    this.form.imagenes = fotos;
    this.form.imagen = fotos[0] || '';
    this.fotoSeleccionada = Math.min(this.fotoSeleccionada, Math.max(0, fotos.length - 1));
  }

  /** La pasa a primer lugar (es la que se ve en la tienda, el carrito y despacho) */
  hacerPrincipal(i: number) {
    if (i <= 0) return;
    const fotos = [...this.fotos];
    const [foto] = fotos.splice(i, 1);
    fotos.unshift(foto);
    this.form.imagenes = fotos;
    this.form.imagen = fotos[0];
    this.fotoSeleccionada = 0;
  }

  /** Cambia el orden (-1 izquierda, +1 derecha) */
  moverFoto(i: number, dir: number) {
    const j = i + dir;
    if (j < 0 || j >= this.fotos.length) return;
    const fotos = [...this.fotos];
    [fotos[i], fotos[j]] = [fotos[j], fotos[i]];
    this.form.imagenes = fotos;
    this.form.imagen = fotos[0];
    this.fotoSeleccionada = j;
  }

  /** @param publicar equipo en preparación (plan canje): guarda y lo pone a la venta */
  async guardar(publicar = false) {
    if (this.guardando || this.subiendoFoto) return;
    const enPreparacion = this.editando?.estado === 'preparacion';
    this.erroresForm = validarEquipo(this.form, { sinPrecios: enPreparacion && !publicar });
    if (this.erroresForm.length) return;

    if (publicar && !this.fotos.length) {
      const r = await Swal.fire({
        title: '¿Publicar sin fotos?',
        text: 'El equipo no tiene fotos: en la tienda se va a ver sin imagen.',
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Publicar igual',
        cancelButtonText: 'Cargar fotos'
      });
      if (!r.isConfirmed) return;
    }

    if (this.avisoImei) {
      const r = await Swal.fire({
        title: 'Revisá el IMEI',
        text: `${this.avisoImei} ¿Guardar igual?`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Guardar igual',
        cancelButtonText: 'Corregir'
      });
      if (!r.isConfirmed) return;
    }

    this.guardando = true;
    try {
      if (this.editando && publicar && enPreparacion) {
        const publicado = await this.equiposService.publicar(this.editando, this.form);
        this.equipos = this.equipos.map(e => e.id === publicado.id ? publicado : e);
        this.toast('Equipo publicado: ya está a la venta');
      } else if (this.editando) {
        const actualizado = await this.equiposService.actualizar(this.editando, this.form);
        this.equipos = this.equipos.map(e => e.id === actualizado.id ? actualizado : e);
        this.toast('Equipo actualizado');
      } else {
        const creado = await this.equiposService.crear(this.form);
        this.equipos = [creado, ...this.equipos];
        this.filtroEstado = 'disponible';
        this.toast('Equipo dado de alta');
      }
      this.mostrarForm = false;
      this.editando = null;
    } catch (e: any) {
      if (e instanceof EquipoError) {
        Swal.fire('No se pudo guardar', e.message, 'warning');
      } else {
        console.error('Error guardando equipo', e);
        Swal.fire('Error', 'No se pudo guardar el equipo. ' + (e?.message || ''), 'error');
      }
    } finally {
      this.guardando = false;
    }
  }

  async eliminar(e: Equipo) {
    if (!esEditable(e)) return;
    const r = await Swal.fire({
      title: '¿Dar de baja este equipo?',
      html: `<strong>${this.esc(nombreEquipo(e))}</strong><br>IMEI ${this.esc(e.imei)}<br>
             <small>Deja de estar a la venta. Queda guardado en "Equipos eliminados" por si hay que recuperarlo.</small>`,
      icon: 'warning',
      input: 'text',
      inputLabel: 'Motivo',
      inputPlaceholder: 'Ej: cargado por error',
      inputValidator: (v: string) => (!v || v.trim().length < 3) ? 'Ingresá un motivo' : null,
      showCancelButton: true,
      confirmButtonText: 'Dar de baja',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#d33'
    });
    if (!r.isConfirmed) return;
    try {
      await this.equiposService.eliminar(e, r.value);
      this.equipos = this.equipos.filter(x => x.id !== e.id);
      if (this.editando?.id === e.id) { this.mostrarForm = false; this.editando = null; }
      this.toast('Equipo dado de baja');
    } catch (err: any) {
      if (err instanceof EquipoError) Swal.fire('No se pudo dar de baja', err.message, 'warning');
      else {
        console.error('Error dando de baja', err);
        Swal.fire('Error', 'No se pudo dar de baja el equipo. ' + (err?.message || ''), 'error');
      }
    }
  }

  // =====================================================
  // EXCEL
  // =====================================================

  exportarExcel() {
    const filas = this.visibles.map(e => ({
      Condición: nombreCondicion(e),
      Modelo: e.modelo,
      Color: e.color,
      Capacidad: e.capacidad,
      IMEI: e.imei,
      'Batería %': e.bateria,
      Grado: e.grado,
      Observaciones: e.observaciones || '',
      Moneda: e.moneda,
      'Precio minorista': e.precioMinorista,
      'Precio mayorista': e.precioMayorista,
      Estado: e.estado === 'vendido' ? 'Vendido' : e.estado === 'preparacion' ? 'En preparación' : 'Disponible',
      'Plan canje: tomado en': e.canje ? Number(e.canje.monto) || 0 : '',
      'Plan canje: cliente': e.canje?.cliente?.nombre || '',
      'Fecha de alta': e.creado?.fecha ? new Date(e.creado.fecha).toLocaleDateString('es-AR') : ''
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas.length ? filas : [{ '': 'Sin datos' }]), 'Equipos');
    XLSX.writeFile(wb, `equipos-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  // =====================================================

  private toast(titulo: string) {
    Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: titulo, showConfirmButton: false, timer: 2200 });
  }

  private esc(t: any): string {
    return String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as any)[c]);
  }
}
