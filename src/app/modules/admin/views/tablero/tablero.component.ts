import { Component, OnInit } from '@angular/core';
import { take } from 'rxjs/operators';
import * as XLSX from 'xlsx';
import Swal from 'sweetalert2';
import { ReportesService, DatosCrudos, Indicadores, RangoFechas, Bucket } from '../../services/reportes.service';
import { SucursalesService } from '../../services/sucursales.service';
import { nombreTipoMovimiento } from 'src/app/modules/despacho/services/movimientos-caja.service';
import { textoPagos, pagosDeVenta } from 'src/app/modules/despacho/services/pagos';

type Periodo = 'hoy' | '7d' | '30d' | 'mes' | 'mesAnterior' | 'custom';

/**
 * Dashboard del negocio: ventas (local + web + reparaciones), egresos, cajas,
 * stock y taller. Los datos del período se traen una vez; cambiar la sucursal recalcula sin volver a leer.
 */
@Component({
  selector: 'app-tablero',
  templateUrl: './tablero.component.html',
  styleUrls: ['./tablero.component.css']
})
export class TableroComponent implements OnInit {

  readonly periodos: { valor: Periodo; nombre: string }[] = [
    { valor: 'hoy', nombre: 'Hoy' },
    { valor: '7d', nombre: '7 días' },
    { valor: '30d', nombre: '30 días' },
    { valor: 'mes', nombre: 'Este mes' },
    { valor: 'mesAnterior', nombre: 'Mes anterior' },
    { valor: 'custom', nombre: 'Elegir fechas' }
  ];

  /** Series del gráfico, en orden fijo (el color sigue a la serie, nunca a la posición) */
  readonly series: { clave: 'local' | 'web' | 'reparaciones'; nombre: string; clase: string }[] = [
    { clave: 'local', nombre: 'Local', clase: 'serie-1' },
    { clave: 'web', nombre: 'Web', clase: 'serie-2' },
    { clave: 'reparaciones', nombre: 'Reparaciones', clase: 'serie-3' }
  ];

  periodo: Periodo = '7d';
  desde: Date = new Date();
  hasta: Date = new Date();
  sucursalId = '';

  sucursales: { id: string; nombre: string }[] = [];
  nombresSucursales: { [id: string]: string } = {};

  cargando = false;
  error = '';
  datos: DatosCrudos | null = null;
  rango: RangoFechas | null = null;
  ind: Indicadores | null = null;
  actualizado: Date | null = null;

  // Gráfico de ventas
  verTablaVentas = false;
  hover: Bucket | null = null;
  hoverIdx = 0;
  ejeMax = 0;
  ticks: number[] = [];

  constructor(
    private reportes: ReportesService,
    private sucursalesService: SucursalesService
  ) { }

  ngOnInit(): void {
    this.sucursalesService.obtenerSucursales().pipe(take(1)).subscribe(lista => {
      this.sucursales = (lista || []).map((s: any) => ({ id: s.id, nombre: s.nombre || s.id }));
      this.sucursales.forEach(s => this.nombresSucursales[s.id] = s.nombre);
    });
    this.elegirPeriodo('7d');
  }

  // =====================================================
  // PERÍODO Y FILTROS
  // =====================================================

  elegirPeriodo(p: Periodo) {
    this.periodo = p;
    if (p === 'custom') return; // espera a que elija las fechas y toque "Ver"
    const hoy = new Date();
    let inicio = new Date(hoy), fin = new Date(hoy);
    switch (p) {
      case '7d': inicio.setDate(hoy.getDate() - 6); break;
      case '30d': inicio.setDate(hoy.getDate() - 29); break;
      case 'mes': inicio = new Date(hoy.getFullYear(), hoy.getMonth(), 1); break;
      case 'mesAnterior':
        inicio = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
        fin = new Date(hoy.getFullYear(), hoy.getMonth(), 0);
        break;
    }
    this.desde = inicio;
    this.hasta = fin;
    this.cargar();
  }

  aplicarFechas() {
    if (!this.desde || !this.hasta) return;
    if (this.desde > this.hasta) {
      Swal.fire('Fechas', 'La fecha "desde" tiene que ser anterior a "hasta".', 'warning');
      return;
    }
    const dias = (this.hasta.getTime() - this.desde.getTime()) / 86400000;
    if (dias > 366) {
      Swal.fire('Fechas', 'Elegí un rango de hasta un año.', 'warning');
      return;
    }
    this.cargar();
  }

  cambiarSucursal() {
    this.recalcular();
  }

  async cargar() {
    const inicio = new Date(this.desde); inicio.setHours(0, 0, 0, 0);
    const fin = new Date(this.hasta); fin.setHours(23, 59, 59, 999);
    this.rango = { inicio, fin };
    this.cargando = true;
    this.error = '';
    try {
      this.datos = await this.reportes.cargar(this.rango);
      this.actualizado = new Date();
      this.recalcular();
    } catch (e: any) {
      console.error('Error cargando el dashboard', e);
      this.error = 'No se pudieron cargar los datos. ' + (e?.message || '');
    } finally {
      this.cargando = false;
    }
  }

  private recalcular() {
    if (!this.datos || !this.rango) return;
    this.ind = this.reportes.calcular(this.datos, this.rango, this.sucursalId || null);
    this.hover = null;
    this.armarEje();
  }

  // =====================================================
  // GRÁFICOS
  // =====================================================

  /** Escala "redonda" del eje (0, 25k, 50k, 75k, 100k...) */
  private armarEje() {
    const max = Math.max(0, ...(this.ind?.porDia || []).map(b => b.total));
    if (max <= 0) { this.ejeMax = 1; this.ticks = [0]; return; }
    const paso0 = max / 4;
    const mag = Math.pow(10, Math.floor(Math.log10(paso0)));
    const paso = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= paso0) || paso0;
    this.ejeMax = paso * Math.ceil(max / paso);
    this.ticks = [];
    for (let v = 0; v <= this.ejeMax + 0.001; v += paso) this.ticks.push(v);
  }

  /** El tooltip acompaña a la columna sin salirse del gráfico */
  posTooltip(): { left: number; transform: string } {
    const n = this.ind?.porDia.length || 1;
    const left = ((this.hoverIdx + 0.5) / n) * 100;
    const transform = left < 20 ? 'translateX(8px)' : left > 80 ? 'translateX(calc(-100% - 8px))' : 'translateX(-50%)';
    return { left, transform };
  }

  alto(valor: number): number {
    return this.ejeMax > 0 ? (valor / this.ejeMax) * 100 : 0;
  }

  /** Serie más alta con valor (la que lleva el borde redondeado arriba) */
  ultimaSerie(b: Bucket): string {
    const conValor = this.series.filter(s => b[s.clave] > 0);
    return conValor.length ? conValor[conValor.length - 1].clave : '';
  }

  /** Muestra la etiqueta del eje X sin amontonar (máx ~12 etiquetas) */
  mostrarEtiqueta(i: number): boolean {
    const n = this.ind?.porDia.length || 0;
    const cada = Math.ceil(n / 12);
    return i % cada === 0;
  }

  ancho(valor: number, lista: { monto: number }[]): number {
    const max = Math.max(0, ...lista.map(x => x.monto));
    return max > 0 ? Math.max(1, (valor / max) * 100) : 0;
  }

  porcentaje(valor: number, total: number): string {
    return total > 0 ? Math.round((valor / total) * 100) + '%' : '-';
  }

  get totalMetodos(): number {
    return (this.ind?.porMetodo || []).reduce((a, m) => a + m.monto, 0);
  }

  get tituloSerie(): string {
    return this.ind?.granularidad === 'hora' ? 'Ventas por hora'
      : this.ind?.granularidad === 'mes' ? 'Ventas por mes' : 'Ventas por día';
  }

  get textoRango(): string {
    if (!this.rango) return '';
    const f = (d: Date) => d.toLocaleDateString('es-AR');
    const a = f(this.rango.inicio), b = f(this.rango.fin);
    return a === b ? a : `${a} al ${b}`;
  }

  // =====================================================
  // FORMATO
  // =====================================================

  moneda(n: number): string {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(Number(n) || 0);
  }

  monedaCorta(n: number): string {
    const v = Number(n) || 0;
    if (Math.abs(v) >= 1e6) return '$' + (v / 1e6).toLocaleString('es-AR', { maximumFractionDigits: 1 }) + ' M';
    if (Math.abs(v) >= 1e3) return '$' + (v / 1e3).toLocaleString('es-AR', { maximumFractionDigits: 0 }) + ' k';
    return '$' + v.toLocaleString('es-AR', { maximumFractionDigits: 0 });
  }

  /** Parte de la venta pagada con un medio (para el Excel) */
  private montoMedio(v: any, metodo: string): number {
    return pagosDeVenta(v).filter(p => p.metodo === metodo).reduce((a, p) => a + p.monto, 0);
  }

  nombreSucursal(id: string): string {
    return this.nombresSucursales[id] || id || '-';
  }

  // =====================================================
  // EXCEL
  // =====================================================

  exportarExcel() {
    if (!this.datos || !this.rango || !this.ind) return;
    const d = this.datos, r = this.rango, ind = this.ind;
    const suc = this.sucursalId || null;
    const enRango = (f: Date | null) => !!f && f >= r.inicio && f <= r.fin;
    const deSuc = (x: any) => !suc || x.sucursalId === suc;
    const fecha = (iso: any) => iso ? new Date(iso).toLocaleString('es-AR') : '';

    const wb = XLSX.utils.book_new();
    const hoja = (nombre: string, filas: any[]) =>
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas.length ? filas : [{ '': 'Sin datos' }]), nombre);

    hoja('Resumen', [
      { Indicador: 'Período', Valor: this.textoRango },
      { Indicador: 'Sucursal', Valor: suc ? this.nombreSucursal(suc) : 'Todas' },
      { Indicador: 'Total vendido', Valor: ind.totalVendido },
      { Indicador: 'Período anterior', Valor: ind.totalVendidoAnterior },
      { Indicador: 'Variación %', Valor: ind.variacion ?? '' },
      { Indicador: 'Ventas local', Valor: ind.ventasLocal },
      { Indicador: 'Tickets local', Valor: ind.ticketsLocal },
      { Indicador: 'Ticket promedio', Valor: ind.ticketPromedio },
      { Indicador: 'Tickets anulados', Valor: ind.anuladosLocal },
      { Indicador: 'Ventas web', Valor: ind.ventasWeb },
      { Indicador: 'Pedidos web', Valor: ind.pedidosWeb },
      { Indicador: 'Cobros de reparaciones', Valor: ind.reparacionesCobradas },
      { Indicador: 'Egresos', Valor: ind.egresos },
      { Indicador: 'Resultado', Valor: ind.resultado },
      { Indicador: 'Diferencias de caja', Valor: ind.diferenciasCaja },
      { Indicador: 'Valor del stock al costo', Valor: ind.valorStockCosto },
      { Indicador: 'Saldo de reparaciones por cobrar', Valor: ind.saldoReparaciones }
    ]);

    hoja(this.tituloSerie, ind.porDia.map(b => ({
      Fecha: b.etiqueta, Local: b.local, Web: b.web, Reparaciones: b.reparaciones, Total: b.total
    })));

    hoja('Tickets', d.ventas
      .filter(v => deSuc(v) && enRango(new Date(v.fecha)))
      .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)))
      .map(v => ({
        'Nº': v.nroTicket ?? '',
        Fecha: fecha(v.fecha),
        Sucursal: this.nombreSucursal(v.sucursalId),
        Tipo: v.tipoVenta === 'reparacion' ? 'Reparación' : 'Venta',
        Cliente: v.cliente?.nombre || 'Consumidor final',
        Lista: v.tipoPrecio || '',
        'Medio de pago': textoPagos(v, n => this.moneda(n)),
        Efectivo: this.montoMedio(v, 'efectivo'),
        Tarjeta: this.montoMedio(v, 'tarjeta'),
        'Transferencia / QR': this.montoMedio(v, 'transferencia'),
        Total: Number(v.total) || 0,
        Vendedor: v.usuario?.nombre || v.usuario?.usuario || '',
        Estado: v.anulada ? 'ANULADO' : 'Vigente',
        'Motivo anulación': v.motivoAnulacion || ''
      })));

    hoja('Pedidos web', d.pedidosFinalizados
      .filter(p => enRango(this.reportes.parseFechaPedido(p.fecha)))
      .map(p => ({
        'Nº': p.nroPedido ?? '',
        Fecha: p.fecha,
        Cliente: [p.nombreCliente, p.apellidoCliente].filter(Boolean).join(' ') || p.user || p.mail || '',
        Entrega: p.entrega || '',
        Pago: p.pago || '',
        Total: Number(p.total) || 0
      })));

    hoja('Productos vendidos', ind.topProductos.length ? this.todosLosProductos() : []);

    hoja('Medios de pago', ind.porMetodo.map(m => ({
      'Medio de pago': m.metodo, Operaciones: m.cantidad, Monto: m.monto,
      '%': this.porcentaje(m.monto, this.totalMetodos)
    })));

    hoja('Vendedores', ind.porVendedor.map(v => ({
      Vendedor: v.vendedor, Tickets: v.tickets, Monto: v.monto
    })));

    hoja('Movimientos de caja', d.movimientos
      .filter(deSuc)
      .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)))
      .map(m => ({
        Fecha: fecha(m.fecha),
        Sucursal: this.nombreSucursal(m.sucursalId),
        Tipo: nombreTipoMovimiento(m.tipo),
        Motivo: m.motivo || '',
        Proveedor: m.proveedor || '',
        Importe: Number(m.importe) || 0,
        Usuario: m.usuario?.nombre || m.usuario?.usuario || '',
        Estado: m.anulado ? 'ANULADO' : 'Vigente'
      })));

    if (!suc) {
      hoja('Gastos generales', d.gastos.map(g => ({
        Fecha: g.fecha?.toDate ? g.fecha.toDate().toLocaleDateString('es-AR') : '',
        Concepto: g.concepto || '',
        Monto: Number(g.monto) || 0,
        Observación: g.observacion || '',
        Estado: g.anulado ? 'ANULADO' : 'Vigente'
      })));
    }

    hoja('Cierres de caja', d.cajasPeriodo
      .filter(deSuc)
      .sort((a, b) => String(a.fechaApertura).localeCompare(String(b.fechaApertura)))
      .map(c => ({
        Apertura: fecha(c.fechaApertura),
        Sucursal: this.nombreSucursal(c.sucursalId),
        'Abrió': c.usuario?.nombre || c.usuario?.usuario || '',
        Cierre: c.abierta ? 'ABIERTA' : fecha(c.fechaCierre),
        'Efectivo esperado': c.cierre?.resumen?.efectivoEsperado ?? '',
        'Efectivo contado': c.cierre?.administrativo ? 'Cierre administrativo' : (c.cierre?.efectivoContado ?? ''),
        Diferencia: c.cierre?.administrativo ? '' : (c.cierre?.diferencia ?? '')
      })));

    hoja('Stock crítico', this.todasLasAlertasStock());

    const nombre = `Reporte JC ${r.inicio.toISOString().slice(0, 10)} a ${r.fin.toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, nombre);
  }

  /** Lista completa de productos vendidos (la tabla de pantalla muestra solo el top 10) */
  private todosLosProductos(): any[] {
    if (!this.datos || !this.rango) return [];
    const r = this.rango, suc = this.sucursalId || null, dolar = this.datos.dolar;
    const mapa = new Map<string, { cantidad: number; monto: number }>();
    const sumar = (n: string, c: number, m: number) => {
      const x = mapa.get(n) || { cantidad: 0, monto: 0 };
      x.cantidad += c; x.monto += m; mapa.set(n, x);
    };
    this.datos.ventas
      .filter(v => (!suc || v.sucursalId === suc) && !v.anulada && v.tipoVenta !== 'reparacion')
      .filter(v => { const f = new Date(v.fecha); return f >= r.inicio && f <= r.fin; })
      .forEach(v => (v.items || []).forEach((i: any) => sumar(i.nombre || '?', Number(i.cantidad) || 0, Number(i.subtotal) || 0)));
    this.datos.pedidosFinalizados
      .filter(p => { const f = this.reportes.parseFechaPedido(p.fecha); return !!f && f >= r.inicio && f <= r.fin; })
      .forEach(p => (p.carrito || []).forEach((i: any) => {
        const c = Number(i.cantidad) || 0;
        sumar(i.nombre || '?', c, (Number(i.precioFinal) || 0) * (i.moneda === 'USD' ? dolar : 1) * c);
      }));
    return [...mapa.entries()]
      .sort((a, b) => b[1].cantidad - a[1].cantidad)
      .map(([nombre, x]) => ({ Producto: nombre, Unidades: x.cantidad, Monto: Math.round(x.monto * 100) / 100 }));
  }

  private todasLasAlertasStock(): any[] {
    if (!this.datos) return [];
    const suc = this.sucursalId || null;
    return this.datos.productos
      .map(p => ({ p, stock: this.reportes.stockDe(p, suc), minimo: Number(p.stockMinimo) || 0 }))
      .filter(x => x.stock <= 0 || (x.minimo > 0 && x.stock <= x.minimo))
      .sort((a, b) => a.stock - b.stock)
      .map(x => ({
        Producto: this.reportes.nombreProducto(x.p),
        Stock: x.stock,
        'Stock mínimo': x.minimo || '',
        Estado: x.stock <= 0 ? 'SIN STOCK' : 'Bajo mínimo'
      }));
  }
}
