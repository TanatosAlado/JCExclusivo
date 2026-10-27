import { Injectable } from '@angular/core';
import { Firestore, collection, query, where, getDocs, doc, getDoc, Timestamp } from '@angular/fire/firestore';
import { pagosDeVenta } from 'src/app/modules/despacho/services/pagos';

// =====================================================================
// Tipos del dashboard
// =====================================================================

export interface RangoFechas {
  inicio: Date;   // 00:00:00 del primer día
  fin: Date;      // 23:59:59 del último día
}

/** Datos crudos que trae Firestore (se calculan los indicadores sobre esto) */
export interface DatosCrudos {
  ventas: any[];             // Ventas del local (incluye período anterior para comparar)
  pedidosFinalizados: any[]; // Pedidos web finalizados (todos; se filtran por fecha)
  pedidosPendientes: any[];
  gastos: any[];
  movimientos: any[];        // MovimientosCaja
  cajasAbiertas: any[];
  cajasPeriodo: any[];
  productos: any[];
  ordenesPendientes: any[];
  dolar: number;
}

export interface Bucket {
  clave: string;
  etiqueta: string;
  local: number;
  web: number;
  reparaciones: number;
  total: number;
}

export interface Indicadores {
  // Período
  totalVendido: number;
  totalVendidoAnterior: number;
  variacion: number | null;           // % contra el período anterior (null si no hay base)

  ventasLocal: number;
  ticketsLocal: number;
  ticketPromedio: number;
  anuladosLocal: number;

  ventasWeb: number;
  pedidosWeb: number;

  reparacionesCobradas: number;
  cobrosReparacion: number;

  egresos: number;                    // gastos generales + gastos de caja + proveedores
  resultado: number;                  // vendido - egresos
  diferenciasCaja: number;
  cierresConDiferencia: number;

  porDia: Bucket[];
  granularidad: 'hora' | 'dia' | 'mes';
  porMetodo: { metodo: string; monto: number; cantidad: number }[];
  porVendedor: { vendedor: string; monto: number; tickets: number }[];
  topProductos: { nombre: string; cantidad: number; monto: number }[];

  // Estado actual (no depende del período)
  cajasAbiertas: { sucursalId: string; desde: string; abrio: string; ventas: number; vieja: boolean }[];
  sinStock: number;
  bajoMinimo: number;
  alertasStock: { nombre: string; stock: number; minimo: number; nivel: 'sin-stock' | 'bajo' }[];
  valorStockCosto: number;
  productosConStock: number;

  ordenesEnTaller: number;
  ordenesListas: number;              // reparadas, esperando que las retiren
  saldoReparaciones: number;          // por cobrar de las órdenes pendientes
  ordenesPorEstado: { estado: string; cantidad: number }[];

  pedidosWebPendientes: number;
  totalPedidosWebPendientes: number;
}

/**
 * Datos para el dashboard y los reportes.
 * Trae la información de Firestore y calcula los indicadores (cálculo separado para poder probarlo).
 */
@Injectable({ providedIn: 'root' })
export class ReportesService {

  constructor(private firestore: Firestore) { }

  /** Período anterior de la misma duración (para comparar) */
  rangoAnterior(r: RangoFechas): RangoFechas {
    const dur = r.fin.getTime() - r.inicio.getTime();
    const fin = new Date(r.inicio.getTime() - 1);
    const inicio = new Date(fin.getTime() - dur);
    inicio.setHours(0, 0, 0, 0);
    return { inicio, fin };
  }

  async cargar(rango: RangoFechas): Promise<DatosCrudos> {
    const anterior = this.rangoAnterior(rango);

    const col = (n: string) => collection(this.firestore, n);
    const lista = async (q: any) => (await getDocs(q)).docs.map((d: any) => ({ id: d.id, ...d.data() }));

    const [
      ventas, pedidosFinalizados, pedidosPendientes, gastos, movimientos,
      cajasAbiertas, cajasPeriodo, productos, ordenesPendientes, info
    ] = await Promise.all([
      lista(query(col('Ventas'),
        where('fecha', '>=', anterior.inicio.toISOString()),
        where('fecha', '<=', rango.fin.toISOString()))),
      lista(col('Pedidos Finalizados')),
      lista(col('Pedidos Pendientes')),
      lista(query(col('gastos'),
        where('fecha', '>=', Timestamp.fromDate(rango.inicio)),
        where('fecha', '<=', Timestamp.fromDate(rango.fin)))),
      lista(query(col('MovimientosCaja'),
        where('fecha', '>=', rango.inicio.toISOString()),
        where('fecha', '<=', rango.fin.toISOString()))),
      lista(query(col('Cajas'), where('abierta', '==', true))),
      lista(query(col('Cajas'),
        where('fechaApertura', '>=', rango.inicio.toISOString()),
        where('fechaApertura', '<=', rango.fin.toISOString()))),
      lista(col('productos')),
      lista(col('Ordenes Pendientes')),
      getDoc(doc(this.firestore, 'InfoEmpresa/general'))
    ]);

    return {
      ventas, pedidosFinalizados, pedidosPendientes, gastos, movimientos,
      cajasAbiertas, cajasPeriodo, productos, ordenesPendientes,
      dolar: Number((info as any)?.data?.()?.dolar) || 1
    };
  }

  // =====================================================================
  // CÁLCULO
  // =====================================================================

  calcular(d: DatosCrudos, rango: RangoFechas, sucursalId: string | null): Indicadores {
    const anterior = this.rangoAnterior(rango);
    const enRango = (f: Date | null, r: RangoFechas) => !!f && f >= r.inicio && f <= r.fin;
    const deSucursal = (x: any) => !sucursalId || x.sucursalId === sucursalId;
    const num = (n: any) => Number(n) || 0;

    // ---------- Ventas del local (incluye cobros de reparación) ----------
    const ventasPeriodo = d.ventas.filter(v => deSucursal(v) && enRango(new Date(v.fecha), rango));
    const vigentes = ventasPeriodo.filter(v => v.anulada !== true);
    const ventasProductos = vigentes.filter(v => v.tipoVenta !== 'reparacion');
    const reparaciones = vigentes.filter(v => v.tipoVenta === 'reparacion');

    const ventasLocal = this.sumar(ventasProductos, v => v.total);
    const reparacionesCobradas = this.sumar(reparaciones, v => v.total);

    // ---------- Pedidos web finalizados (no tienen sucursal: siempre se suman) ----------
    const fechaPedido = (p: any) => this.parseFechaPedido(p.fecha);
    const webPeriodo = d.pedidosFinalizados.filter(p => enRango(fechaPedido(p), rango));
    const ventasWeb = this.sumar(webPeriodo, p => p.total);

    const totalVendido = ventasLocal + reparacionesCobradas + ventasWeb;

    // ---------- Período anterior (para la variación) ----------
    const ventasAnt = d.ventas.filter(v => deSucursal(v) && v.anulada !== true && enRango(new Date(v.fecha), anterior));
    const webAnt = d.pedidosFinalizados.filter(p => enRango(fechaPedido(p), anterior));
    const totalVendidoAnterior = this.sumar(ventasAnt, v => v.total) + this.sumar(webAnt, p => p.total);
    const variacion = totalVendidoAnterior > 0
      ? Math.round(((totalVendido - totalVendidoAnterior) / totalVendidoAnterior) * 1000) / 10
      : null;

    // ---------- Egresos ----------
    const gastosGenerales = this.sumar(d.gastos.filter(g => g.anulado !== true), g => g.monto);
    const movVigentes = d.movimientos.filter(m => m.anulado !== true && deSucursal(m));
    const gastosCaja = this.sumar(movVigentes.filter(m => m.tipo === 'gasto' || m.tipo === 'proveedor'), m => m.importe);
    // Los gastos generales no tienen sucursal: con filtro de sucursal se toman solo los de caja
    const egresos = (sucursalId ? 0 : gastosGenerales) + gastosCaja;

    // ---------- Cajas ----------
    const cierres = d.cajasPeriodo.filter(c => deSucursal(c) && c.cierre && !c.cierre.administrativo);
    const diferenciasCaja = this.redondear(this.sumar(cierres, c => c.cierre.diferencia));
    const cierresConDiferencia = cierres.filter(c => Math.abs(num(c.cierre.diferencia)) >= 0.01).length;

    // ---------- Serie temporal ----------
    const dias = Math.round((rango.fin.getTime() - rango.inicio.getTime()) / 86400000);
    const granularidad: Indicadores['granularidad'] = dias <= 1 ? 'hora' : (dias > 62 ? 'mes' : 'dia');
    const porDia = this.armarSerie(rango, granularidad, ventasProductos, reparaciones, webPeriodo, fechaPedido);

    // ---------- Medios de pago (local + reparaciones + web) ----------
    const metodos = new Map<string, { monto: number; cantidad: number }>();
    const sumarMetodo = (metodo: string, monto: number) => {
      const m = metodos.get(metodo) || { monto: 0, cantidad: 0 };
      m.monto += monto; m.cantidad++;
      metodos.set(metodo, m);
    };
    // Una venta pagada con varios medios suma cada parte a su medio
    vigentes.forEach(v => pagosDeVenta(v).forEach(p => sumarMetodo(this.nombreMetodo(p.metodo), p.monto)));
    webPeriodo.forEach(p => sumarMetodo(this.nombreMetodo(p.pago), num(p.total)));
    const porMetodo = [...metodos.entries()]
      .map(([metodo, x]) => ({ metodo, monto: this.redondear(x.monto), cantidad: x.cantidad }))
      .sort((a, b) => b.monto - a.monto);

    // ---------- Vendedores (local) ----------
    const vendedores = new Map<string, { monto: number; tickets: number }>();
    vigentes.forEach(v => {
      const nombre = v.usuario?.nombre || v.usuario?.usuario || 'Sin registrar';
      const x = vendedores.get(nombre) || { monto: 0, tickets: 0 };
      x.monto += num(v.total); x.tickets++;
      vendedores.set(nombre, x);
    });
    const porVendedor = [...vendedores.entries()]
      .map(([vendedor, x]) => ({ vendedor, monto: this.redondear(x.monto), tickets: x.tickets }))
      .sort((a, b) => b.monto - a.monto);

    // ---------- Productos más vendidos (local + web) ----------
    const prod = new Map<string, { cantidad: number; monto: number }>();
    const sumarProd = (nombre: string, cantidad: number, monto: number) => {
      const x = prod.get(nombre) || { cantidad: 0, monto: 0 };
      x.cantidad += cantidad; x.monto += monto;
      prod.set(nombre, x);
    };
    ventasProductos.forEach(v => (v.items || []).forEach((i: any) => sumarProd(i.nombre || '?', num(i.cantidad), num(i.subtotal))));
    webPeriodo.forEach(p => (p.carrito || []).forEach((i: any) => {
      const precio = num(i.precioFinal) * (i.moneda === 'USD' ? d.dolar : 1);
      sumarProd(i.nombre || '?', num(i.cantidad), precio * num(i.cantidad));
    }));
    const topProductos = [...prod.entries()]
      .map(([nombre, x]) => ({ nombre, cantidad: x.cantidad, monto: this.redondear(x.monto) }))
      .sort((a, b) => b.cantidad - a.cantidad || b.monto - a.monto)
      .slice(0, 10);

    // ---------- Cajas abiertas ahora ----------
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const cajasAbiertas = d.cajasAbiertas.filter(deSucursal).map(c => ({
      sucursalId: c.sucursalId,
      desde: c.fechaApertura,
      abrio: c.usuario?.nombre || c.usuario?.usuario || '-',
      ventas: num(c.cantidadVentas),
      vieja: new Date(c.fechaApertura) < hoy
    }));

    // ---------- Stock ----------
    const alertasStock: Indicadores['alertasStock'] = [];
    let sinStock = 0, bajoMinimo = 0, valorStockCosto = 0, productosConStock = 0;
    for (const p of d.productos) {
      const stock = this.stockDe(p, sucursalId);
      const minimo = num(p.stockMinimo);
      const costo = num(p.precioCosto) * (p.moneda === 'USD' ? d.dolar : 1);
      if (stock > 0) {
        productosConStock++;
        valorStockCosto += stock * costo;
      }
      if (stock <= 0) {
        sinStock++;
        alertasStock.push({ nombre: this.nombreProducto(p), stock, minimo, nivel: 'sin-stock' });
      } else if (minimo > 0 && stock <= minimo) {
        bajoMinimo++;
        alertasStock.push({ nombre: this.nombreProducto(p), stock, minimo, nivel: 'bajo' });
      }
    }
    alertasStock.sort((a, b) => (a.nivel === b.nivel ? a.stock - b.stock : a.nivel === 'sin-stock' ? -1 : 1));

    // ---------- Taller ----------
    const estados = new Map<string, number>();
    let ordenesListas = 0, saldoReparaciones = 0;
    for (const o of d.ordenesPendientes) {
      const estado = o.estado || 'Pendiente';
      estados.set(estado, (estados.get(estado) || 0) + 1);
      if (/finalizad|listo/i.test(estado)) ordenesListas++;
      const pagado = (o.cobros || []).filter((c: any) => !c.anulado).reduce((a: number, c: any) => a + num(c.monto), 0);
      saldoReparaciones += Math.max(0, num(o.presupuesto) - pagado);
    }
    const ordenesPorEstado = [...estados.entries()]
      .map(([estado, cantidad]) => ({ estado, cantidad }))
      .sort((a, b) => b.cantidad - a.cantidad);

    return {
      totalVendido: this.redondear(totalVendido),
      totalVendidoAnterior: this.redondear(totalVendidoAnterior),
      variacion,
      ventasLocal: this.redondear(ventasLocal),
      ticketsLocal: ventasProductos.length,
      ticketPromedio: ventasProductos.length ? this.redondear(ventasLocal / ventasProductos.length) : 0,
      anuladosLocal: ventasPeriodo.length - vigentes.length,
      ventasWeb: this.redondear(ventasWeb),
      pedidosWeb: webPeriodo.length,
      reparacionesCobradas: this.redondear(reparacionesCobradas),
      cobrosReparacion: reparaciones.length,
      egresos: this.redondear(egresos),
      resultado: this.redondear(totalVendido - egresos),
      diferenciasCaja,
      cierresConDiferencia,
      porDia,
      granularidad,
      porMetodo,
      porVendedor,
      topProductos,
      cajasAbiertas,
      sinStock,
      bajoMinimo,
      alertasStock: alertasStock.slice(0, 15),
      valorStockCosto: this.redondear(valorStockCosto),
      productosConStock,
      ordenesEnTaller: d.ordenesPendientes.length - ordenesListas,
      ordenesListas,
      saldoReparaciones: this.redondear(saldoReparaciones),
      ordenesPorEstado,
      pedidosWebPendientes: d.pedidosPendientes.length,
      totalPedidosWebPendientes: this.redondear(this.sumar(d.pedidosPendientes, p => p.total))
    };
  }

  // =====================================================================
  // AUXILIARES
  // =====================================================================

  private armarSerie(
    rango: RangoFechas,
    gran: Indicadores['granularidad'],
    local: any[], reparaciones: any[], web: any[],
    fechaPedido: (p: any) => Date | null
  ): Bucket[] {
    const buckets = new Map<string, Bucket>();
    const claveDe = (f: Date) =>
      gran === 'hora' ? String(f.getHours()).padStart(2, '0')
      : gran === 'mes' ? `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}`
      : `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`;
    const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    const etiquetaDe = (f: Date) =>
      gran === 'hora' ? `${String(f.getHours()).padStart(2, '0')} h`
      : gran === 'mes' ? `${meses[f.getMonth()]} ${String(f.getFullYear()).slice(2)}`
      : `${f.getDate()}/${f.getMonth() + 1}`;

    // Todos los buckets del rango (aunque estén en cero)
    const cursor = new Date(rango.inicio);
    if (gran === 'hora') {
      for (let h = 0; h < 24; h++) {
        const f = new Date(rango.inicio); f.setHours(h);
        buckets.set(claveDe(f), { clave: claveDe(f), etiqueta: etiquetaDe(f), local: 0, web: 0, reparaciones: 0, total: 0 });
      }
    } else {
      while (cursor <= rango.fin) {
        const k = claveDe(cursor);
        if (!buckets.has(k)) buckets.set(k, { clave: k, etiqueta: etiquetaDe(cursor), local: 0, web: 0, reparaciones: 0, total: 0 });
        if (gran === 'mes') cursor.setMonth(cursor.getMonth() + 1, 1); else cursor.setDate(cursor.getDate() + 1);
      }
    }

    const sumar = (f: Date | null, campo: 'local' | 'web' | 'reparaciones', monto: number) => {
      if (!f) return;
      const b = buckets.get(claveDe(f));
      if (!b) return;
      b[campo] += monto;
      b.total += monto;
    };
    local.forEach(v => sumar(new Date(v.fecha), 'local', Number(v.total) || 0));
    reparaciones.forEach(v => sumar(new Date(v.fecha), 'reparaciones', Number(v.total) || 0));
    web.forEach(p => sumar(fechaPedido(p), 'web', Number(p.total) || 0));

    let lista = [...buckets.values()];
    // Por hora: se recortan las horas sin movimiento al principio y al final (ej. 9 a 21 h)
    if (gran === 'hora') {
      const conDatos = lista.map((b, i) => b.total > 0 ? i : -1).filter(i => i >= 0);
      const desde = conDatos.length ? Math.min(conDatos[0], 9) : 9;
      const hasta = conDatos.length ? Math.max(conDatos[conDatos.length - 1], 20) : 20;
      lista = lista.slice(desde, hasta + 1);
    }
    return lista.map(b => ({
      ...b,
      local: this.redondear(b.local), web: this.redondear(b.web),
      reparaciones: this.redondear(b.reparaciones), total: this.redondear(b.total)
    }));
  }

  /** "27/10/2026 14:35" → Date (formato de los pedidos web) */
  parseFechaPedido(fecha: any): Date | null {
    if (!fecha) return null;
    if (typeof fecha?.toDate === 'function') return fecha.toDate();
    const m = String(fecha).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
    if (!m) {
      const d = new Date(fecha);
      return isNaN(d.getTime()) ? null : d;
    }
    return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4] || 0), Number(m[5] || 0));
  }

  nombreMetodo(metodo: any): string {
    const m = String(metodo || '').toLowerCase();
    if (m.includes('efectivo')) return 'Efectivo';
    if (m.includes('tarjeta')) return 'Tarjeta';
    if (m.includes('transferencia') || m.includes('qr')) return 'Transferencia / QR';
    return 'Sin especificar';
  }

  stockDe(p: any, sucursalId: string | null): number {
    const suc = p.stockSucursales;
    const lista: { sucursalId: string; cantidad: number }[] = !suc ? []
      : Array.isArray(suc) ? suc
      : Object.entries(suc).map(([id, c]) => ({ sucursalId: id, cantidad: Number(c) || 0 }));
    if (sucursalId) {
      return Number(lista.find(s => s.sucursalId === sucursalId)?.cantidad) || 0;
    }
    return lista.reduce((a, s) => a + (Number(s.cantidad) || 0), 0) + (Number(p.stockMayorista) || 0);
  }

  nombreProducto(p: any): string {
    const extra = [p.modelo, p.color && !String(p.color).startsWith('#') ? p.color : null].filter(Boolean).join(' ');
    return `${p.descripcion || p.nombre || 'Sin nombre'}${extra ? ' - ' + extra : ''}`;
  }

  private sumar(lista: any[], f: (x: any) => any): number {
    return lista.reduce((a, x) => a + (Number(f(x)) || 0), 0);
  }

  private redondear(n: number): number {
    return Math.round((Number(n) || 0) * 100) / 100;
  }
}
