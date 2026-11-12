import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { ModeloTasador, RespuestaSiNo, ResultadoTasacion, calcularTasacion, textoUSD } from '../../utils/tasador';

/**
 * 🧮 Tasación de un equipo usado: modelo → capacidad → preguntas Sí/No → valor en USD (y en pesos).
 * Se usa en Despacho (Plan canje) y en Gestiones → Tasador (para probar).
 */
@Component({
  selector: 'app-tasar-equipo',
  templateUrl: './tasar-equipo.component.html',
  styleUrls: ['./tasar-equipo.component.css']
})
export class TasarEquipoComponent implements OnChanges {

  /** Modelos activos del tasador */
  @Input() modelos: ModeloTasador[] = [];
  /** $ por USD para mostrar el valor en pesos (opcional) */
  @Input() cotizacion: number | null = null;
  /** Texto del botón final */
  @Input() textoBoton = 'Usar este valor';
  /** Modelo con el que arranca (por id o por nombre), opcional */
  @Input() modeloInicial: string | null = null;
  /** Mostrar el valor tasado dentro del componente (en la web se muestra recién después del botón) */
  @Input() mostrarValor = true;

  @Output() usar = new EventEmitter<ResultadoTasacion>();
  @Output() cancelar = new EventEmitter<void>();

  filtro = '';
  modeloId: string | null = null;
  capacidad: string | null = null;
  respuestas: { [preguntaId: string]: RespuestaSiNo } = {};
  readonly textoUSD = textoUSD;

  ngOnChanges(cambios: SimpleChanges): void {
    if ((cambios['modelos'] || cambios['modeloInicial']) && this.modeloInicial && !this.modeloId) {
      const ini = String(this.modeloInicial).trim().toLowerCase();
      const m = this.modelos.find(x => x.id === this.modeloInicial || String(x.nombre).trim().toLowerCase() === ini);
      if (m) this.elegirModelo(m);
    }
  }

  get modelosFiltrados(): ModeloTasador[] {
    const t = this.filtro.trim().toLowerCase();
    return t ? this.modelos.filter(m => String(m.nombre).toLowerCase().includes(t)) : this.modelos;
  }

  get modelo(): ModeloTasador | null {
    return this.modelos.find(m => m.id === this.modeloId) || null;
  }

  elegirModelo(m: ModeloTasador) {
    this.modeloId = m.id || null;
    this.respuestas = {};
    // Si tiene una sola capacidad, queda elegida
    this.capacidad = (m.capacidades || []).length === 1 ? m.capacidades[0].capacidad : null;
  }

  cambiarModelo() {
    this.modeloId = null;
    this.capacidad = null;
    this.respuestas = {};
  }

  responder(preguntaId: string, r: RespuestaSiNo) {
    this.respuestas = { ...this.respuestas, [preguntaId]: r };
  }

  /** Respuesta que descuenta para una pregunta (para pintarla) */
  descuenta(p: { id: string; descuentaSi: RespuestaSiNo }): boolean {
    return this.respuestas[p.id] === p.descuentaSi;
  }

  get calculo() {
    return calcularTasacion(this.modelo, this.capacidad, this.respuestas, this.cotizacion);
  }

  confirmar() {
    const c = this.calculo;
    if (!c.resultado || !c.completa) return;
    this.usar.emit(c.resultado);
  }

  reiniciar() {
    this.respuestas = {};
  }
}
