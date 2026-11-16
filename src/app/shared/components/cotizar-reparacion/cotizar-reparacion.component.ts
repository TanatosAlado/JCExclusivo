import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { CotizadorReparacionesService } from 'src/app/modules/admin/services/cotizador-reparaciones.service';
import {
  AVISO_MANO_DE_OBRA, CotizacionReparacion, ModeloReparacion, PlantillaReparaciones, RubroDelModelo, SeleccionReparacion,
  TipoPrecioReparacion, calcularCotizacionReparacion, productosDelModelo, rubrosDelModelo, textoPesos
} from '../../utils/cotizador-reparaciones';

/**
 * 🔧 Cotizar una reparación: modelo → qué hay que reparar (varios rubros) → un repuesto por rubro → total en $ (solo repuestos).
 * Los precios y el stock se leen de los productos al elegir el modelo.
 * Se usa en Despacho (para armar la orden del taller), en Gestiones (para probar) y en la web.
 */
@Component({
  selector: 'app-cotizar-reparacion',
  templateUrl: './cotizar-reparacion.component.html',
  styleUrls: ['./cotizar-reparacion.component.css']
})
export class CotizarReparacionComponent implements OnChanges {

  @Input() modelos: ModeloReparacion[] = [];
  @Input() plantilla: PlantillaReparaciones | null = null;
  /** Lista de precios del cliente */
  @Input() tipoPrecio: TipoPrecioReparacion = 'minorista';
  /** $ por USD para los repuestos cargados en dólares */
  @Input() dolar: number | null = null;
  /** Mostrar los repuestos sin stock (marcados, no se pueden elegir). En la web, no. */
  @Input() mostrarSinStock = false;
  /** Campo de descuento con 2 o más repuestos (en el local; en la web no) */
  @Input() permitirDescuento = false;
  @Input() textoBoton = 'Usar esta cotización';
  /** Botón secundario opcional (ej. "Solo cotizar") */
  @Input() textoBotonSecundario: string | null = null;

  @Output() usar = new EventEmitter<CotizacionReparacion>();
  @Output() usarSecundario = new EventEmitter<CotizacionReparacion>();
  @Output() cancelar = new EventEmitter<void>();

  filtro = '';
  modeloId: string | null = null;
  productos: { [id: string]: any } = {};
  cargandoProductos = false;
  errorProductos = '';
  seleccion: SeleccionReparacion = {};
  descuento: number | null = null;
  readonly textoPesos = textoPesos;
  readonly avisoManoDeObra = AVISO_MANO_DE_OBRA;

  constructor(private cotizador: CotizadorReparacionesService) { }

  ngOnChanges(cambios: SimpleChanges): void {
    if (cambios['modelos'] && this.modeloId && !this.modelo) this.cambiarModelo();
  }

  get modelosFiltrados(): ModeloReparacion[] {
    const t = this.filtro.trim().toLowerCase();
    return t ? this.modelos.filter(m => String(m.nombre).toLowerCase().includes(t)) : this.modelos;
  }

  get modelo(): ModeloReparacion | null {
    return this.modelos.find(m => m.id === this.modeloId) || null;
  }

  /**
   * Rubros con sus opciones. Se guarda el resultado mientras no cambien los datos: si se armara una lista nueva
   * en cada repaso de pantalla, Angular redibujaba los rubros justo en el clic y el tilde se perdía.
   */
  get rubros(): RubroDelModelo[] {
    const m = this.modelo;
    const clave = [m?.id, this.tipoPrecio, this.dolar, this.mostrarSinStock].join('|');
    if (this.cacheRubros && this.cacheRubros.clave === clave && this.cacheRubros.productos === this.productos
        && this.cacheRubros.plantilla === this.plantilla && this.cacheRubros.modelo === m) {
      return this.cacheRubros.lista;
    }
    const lista = rubrosDelModelo(this.plantilla, m, this.productos, this.tipoPrecio, this.dolar, this.mostrarSinStock);
    this.cacheRubros = { clave, productos: this.productos, plantilla: this.plantilla, modelo: m, lista };
    return lista;
  }
  private cacheRubros: { clave: string; productos: any; plantilla: any; modelo: any; lista: RubroDelModelo[] } | null = null;

  trackRubro(_: number, r: RubroDelModelo) {
    return r.rubro.id;
  }

  trackOpcion(_: number, o: { productoId: string }) {
    return o.productoId;
  }

  /** Elige el modelo y lee sus repuestos (precio y stock de ahora) */
  async elegirModelo(m: ModeloReparacion) {
    this.modeloId = m.id || null;
    this.seleccion = {};
    this.descuento = null;
    this.productos = {};
    this.errorProductos = '';
    this.cargandoProductos = true;
    try {
      this.productos = await this.cotizador.productos(productosDelModelo(m));
    } catch (e) {
      console.error('No se pudieron leer los repuestos', e);
      this.errorProductos = 'No pudimos leer los repuestos. Probá de nuevo.';
    } finally {
      this.cargandoProductos = false;
    }
  }

  cambiarModelo() {
    this.modeloId = null;
    this.seleccion = {};
    this.descuento = null;
    this.productos = {};
  }

  tildado(rubroId: string): boolean {
    return this.seleccion[rubroId] !== undefined;
  }

  /** El precio más bajo del rubro (de los que tienen stock) */
  desde(r: RubroDelModelo): number {
    const p = r.opciones.filter(o => o.conStock).map(o => o.precio);
    return p.length ? Math.min(...p) : 0;
  }

  /** ¿El rubro tiene algo con stock? */
  hayStock(r: RubroDelModelo): boolean {
    return r.opciones.some(o => o.conStock);
  }

  /** Tildar un rubro: si tiene un solo repuesto con stock, queda elegido */
  alternarRubro(r: RubroDelModelo) {
    const nueva = { ...this.seleccion };
    if (this.tildado(r.rubro.id)) delete nueva[r.rubro.id];
    else {
      const conStock = r.opciones.filter(o => o.conStock);
      if (!conStock.length) return;
      nueva[r.rubro.id] = conStock.length === 1 ? conStock[0].productoId : null;
    }
    this.seleccion = nueva;
    if (this.cantidadElegida < 2) this.descuento = null;
  }

  /** Un solo repuesto por rubro (los sin stock no se pueden elegir) */
  elegirRepuesto(r: RubroDelModelo, productoId: string) {
    const o = r.opciones.find(x => x.productoId === productoId);
    if (!o || !o.conStock) return;
    this.seleccion = { ...this.seleccion, [r.rubro.id]: productoId };
  }

  get sinElegir(): string[] {
    return this.rubros.filter(r => this.tildado(r.rubro.id) && !this.seleccion[r.rubro.id]).map(r => r.rubro.nombre);
  }

  get cantidadElegida(): number {
    return Object.values(this.seleccion).filter(Boolean).length;
  }

  get calculo() {
    const descuento = this.permitirDescuento && this.cantidadElegida >= 2 ? this.descuento : 0;
    return calcularCotizacionReparacion(this.plantilla, this.modelo, this.productos, this.seleccion,
      { tipo: this.tipoPrecio, dolar: this.dolar, descuento });
  }

  get lista(): boolean {
    const c = this.calculo;
    return !!c.resultado && !c.error && !this.sinElegir.length && !this.cargandoProductos;
  }

  confirmar(secundario = false) {
    const r = this.calculo.resultado;
    if (!r || !this.lista) return;
    (secundario ? this.usarSecundario : this.usar).emit(r);
  }

  reiniciar() {
    this.seleccion = {};
    this.descuento = null;
  }
}
