import { Injectable } from '@angular/core';
import { Firestore, collection, query, where, getDocs, doc, getDoc, Timestamp } from '@angular/fire/firestore';
import { pagosDeVenta, aCuentaDeVenta, esCobroDeuda, esCobroCuota, creditoDeVenta } from 'src/app/modules/despacho/services/pagos';
import { resumenCartera } from 'src/app/modules/despacho/services/credito-casa';
import { conTotalEnPesos } from 'src/app/shared/utils/total-pedido';
import { totalesDesglose } from 'src/app/modules/despacho/services/desglose-reparacion';
import { sucursalTaller } from 'src/app/modules/despacho/services/cuenta-taller';
import { FilaSucursal, filasPorSucursal, totalesTaller, totalFilas, TrabajoTaller, trabajosDelPeriodo } from './resultado-sucursales';

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
  cuentas?: any[];           // CuentasCorrientes (saldo actual de cada cliente)
  equipos?: any[];           // Equipos (todos: disponibles y vendidos)
  dolar: number;
  dolarJC?: number;          // dólar de los equipos (si no está, el común)
  sucursales?: any[];        // Sucursales (para el resultado por sucursal)
  cuentasInternas?: any[];   // CuentasInternas (lo que el local le debe hoy al taller)
  trabajosTaller?: TrabajoTaller[];  // cargos del taller al local en el período
  creditos?: any[];          // Creditos (crédito de la casa: todos, para el saldo de hoy)
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
  // De lo cobrado en reparaciones: mano de obra, repuestos y lo cargado antes de discriminar
  reparacionesManoObra: number;
  reparacionesRepuestos: number;
  reparacionesSinDiscriminar: number;

  // Cuenta corriente
  ventasACuenta: number;              // parte de las ventas del período que quedó a cuenta (no entró dinero)
  cobrosCuenta: number;               // deudas cobradas en el período (entró dinero, no es venta nueva)
  cantidadCobrosCuenta: number;
  deudaCuentas: number;               // lo que deben hoy los clientes (no depende del período)
  cuentasConDeuda: number;

  // 🏠 Crédito de la casa
  ventasACredito: number;             // financiado en el período (parte de las ventas que quedó en cuotas)
  cantidadVentasCredito: number;
  cobrosCuotas: number;               // cobrado de cuotas en el período (entró dinero, no es venta nueva)
  cantidadCobrosCuotas: number;
  recargosCuotas: number;             // de eso, recargos por pagar fuera de término
  deudaCreditos: number;              // hoy: lo que falta cobrar de los créditos vigentes
  deudaCreditosVencida: number;       // hoy: de eso, lo vencido
  creditosVigentes: number;
  creditosConAtraso: number;

  // Equipos
  equiposVendidos: number;            // en el período (local + web finalizados)
  montoEquiposVendidos: number;       // en pesos
  equiposDisponibles: number;         // hoy
  stockEquiposUsd: number;            // precio minorista de los disponibles en USD
  stockEquiposArs: number;            // ídem, los cargados en pesos
  stockEquiposPesos: number;          // todo en pesos (USD × dólar JC)
  equiposReservadosWeb: number;       // en pedidos web pendientes

  egresos: number;                    // gastos generales + gastos de caja + proveedores
  resultado: number;                  // vendido - egresos (con sucursal: el de esa sucursal, con el costo de taller)

  // Taller interno (lo que el taller le cobra al local por las reparaciones)
  costoTaller: number;                // cargado al local en el período
  cantidadTrabajos: number;
  presupuestoTrabajos: number;        // lo que se les cobra a los clientes por esas órdenes
  gananciaTrabajos: number;           // presupuesto − costo de taller
  trabajosParaLocal: number;          // visto desde el taller: lo que le cargó al local
  cantidadTrabajosTaller: number;
  deudaInternaTaller: number;         // hoy: lo que el local le debe al taller
  hayTaller: boolean;                 // existe la sucursal del taller
  esTallerSeleccionado: boolean;

  // Resultado por sucursal (siempre todas, no depende del filtro)
  porSucursal: FilaSucursal[];
  totalSucursales: FilaSucursal;
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
    // Si no se pueden leer las cuentas corrientes (permisos), el resto del dashboard sigue
    const cuentas = await lista(col('CuentasCorrientes')).catch(() => []);
    const equipos = await lista(col('Equipos')).catch(() => []);
    const sucursales = await lista(col('Sucursales')).catch(() => []);
    const creditos = await lista(col('Creditos')).catch(() => []);
    const { cuentasInternas, trabajosTaller } = await this.cargarTrabajosTaller(rango).catch(err => {
      console.warn('No se pudo leer la cuenta Local–Taller', err);
      return { cuentasInternas: [], trabajosTaller: [] };
    });

    const dolar = Number((info as any)?.data?.()?.dolar) || 1;
    const dolarJC = Number((info as any)?.data?.()?.dolarJC) || 0;
    // Pedidos que quedaron con el total en dólares (error viejo): se toman en pesos
    const cot = { dolar, dolarJC };
    return {
      ventas,
      pedidosFinalizados: pedidosFinalizados.map((p: any) => conTotalEnPesos(p, cot)),
      pedidosPendientes: pedidosPendientes.map((p: any) => conTotalEnPesos(p, cot)),
      gastos, movimientos,
      cajasAbiertas, cajasPeriodo, productos, ordenesPendientes, cuentas, equipos,
      sucursales, cuentasInternas, trabajosTaller, creditos,
      dolar,
      dolarJC
    };
  }

  /** Cuentas Local–Taller y los trabajos (cargos) del período, de todas las cuentas */
  private async cargarTrabajosTaller(rango: RangoFechas): Promise<{ cuentasInternas: any[]; trabajosTaller: TrabajoTaller[] }> {
    const cuentas = (await getDocs(collection(this.firestore, 'CuentasInternas'))).docs
      .map((d: any) => ({ id: d.id, ...d.data() }));
    const porCuenta = await Promise.all(cuentas.map(async (c: any) => {
      const snap = await getDocs(query(
        collection(this.firestore, 'CuentasInternas', c.id, 'Movimientos'),
        where('fecha', '>=', rango.inicio.toISOString()),
        where('fecha', '<=', rango.fin.toISOString())
      ));
      const movs = snap.docs.map((d: any) => ({ id: d.id, cuentaId: c.id, deudor: c.deudor, acreedor: c.acreedor, ...d.data() }));
      return trabajosDelPeriodo(movs, rango.inicio, rango.fin);
    }));
    return { cuentasInternas: cuentas, trabajosTaller: porCuenta.flat() };
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
    // Los cobros de cuenta corriente no son ventas (la venta se contó cuando se llevó la mercadería)
    const cobrosCuentaPeriodo = vigentes.filter(v => v.tipoVenta === 'cobrocuenta');
    const ventasProductos = vigentes.filter(v => v.tipoVenta !== 'reparacion' && !esCobroDeuda(v));
    const cobrosCuotasPeriodo = vigentes.filter(v => esCobroCuota(v));
    const ventasCredito = ventasProductos.filter(v => creditoDeVenta(v) > 0);
    const cartera = resumenCartera((d.creditos || []).filter(c => deSucursal(c)));
    const reparaciones = vigentes.filter(v => v.tipoVenta === 'reparacion');

    const ventasLocal = this.sumar(ventasProductos, v => v.total);
    const reparacionesCobradas = this.sumar(reparaciones, v => v.total);
    const desgloseReparaciones = totalesDesglose(reparaciones);

    // ---------- Pedidos web finalizados (no tienen sucursal: siempre se suman) ----------
    const fechaPedido = (p: any) => this.parseFechaPedido(p.fecha);
    const webPeriodo = d.pedidosFinalizados.filter(p => enRango(fechaPedido(p), rango));
    const ventasWeb = this.sumar(webPeriodo, p => p.total);

    const totalVendido = ventasLocal + reparacionesCobradas + ventasWeb;

    // ---------- Período anterior (para la variación) ----------
    const ventasAnt = d.ventas.filter(v => deSucursal(v) && v.anulada !== true && !esCobroDeuda(v) && enRango(new Date(v.fecha), anterior));
    const webAnt = d.pedidosFinalizados.filter(p => enRango(fechaPedido(p), anterior));
    const totalVendidoAnterior = this.sumar(ventasAnt, v => v.total) + this.sumar(webAnt, p => p.total);
    const variacion = totalVendidoAnterior > 0
      ? Math.round(((totalVendido - totalVendidoAnterior) / totalVendidoAnterior) * 1000) / 10
      : null;

    // ---------- Egresos ----------
    const gastosGenerales = this.sumar(d.gastos.filter(g => g.anulado !== true), g => g.monto);
    const movVigentes = d.movimientos.filter(m => m.anulado !== true && deSucursal(m));
    // Los pagos del local al taller (cuenta interna) no son gastos del negocio: es plata que pasa de una caja a otra
    const gastosCaja = this.sumar(movVigentes.filter(m => (m.tipo === 'gasto' || m.tipo === 'proveedor') && m.interno !== true), m => m.importe);
    // Los gastos generales no tienen sucursal: con filtro de sucursal se toman solo los de caja
    const egresos = (sucursalId ? 0 : gastosGenerales) + gastosCaja;

    // ---------- Resultado por sucursal y taller interno ----------
    const taller = sucursalTaller(d.sucursales || []);
    const listaSucursales = (d.sucursales || [])
      .filter((s: any) => s.activa !== false || d.ventas.some(v => v.sucursalId === s.id))
      .map((s: any) => ({ id: s.id, nombre: s.nombre || s.id, esTaller: !!taller && s.id === taller.id }));
    const trabajosPeriodo = d.trabajosTaller || [];
    const porSucursal = filasPorSucursal({
      sucursales: listaSucursales,
      ventas: d.ventas.filter(v => v.anulada !== true && enRango(new Date(v.fecha), rango)),
      movimientos: d.movimientos.filter(m => m.anulado !== true),
      trabajos: trabajosPeriodo,
      ventasWeb: this.sumar(d.pedidosFinalizados.filter(p => enRango(this.parseFechaPedido(p.fecha), rango)), p => p.total),
      pedidosWeb: d.pedidosFinalizados.filter(p => enRango(this.parseFechaPedido(p.fecha), rango)).length,
      gastosGenerales: this.sumar(d.gastos.filter(g => g.anulado !== true), g => g.monto)
    });
    const totalSucursales = totalFilas(porSucursal);
    const filaElegida = sucursalId ? porSucursal.find(f => f.id === sucursalId) : null;
    const tTaller = totalesTaller(trabajosPeriodo, sucursalId);
    const deudaInternaTaller = this.redondear(this.sumar(
      (d.cuentasInternas || []).filter(c => !sucursalId || c.deudor?.id === sucursalId || c.acreedor?.id === sucursalId),
      c => Math.max(0, num(c.saldo))));

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
    // Una venta pagada con varios medios suma cada parte a su medio.
    // Es cómo se pagaron las ventas: incluye "Cuenta corriente" y no los cobros de deudas (no duplicar)
    vigentes.filter(v => !esCobroDeuda(v))
      .forEach(v => pagosDeVenta(v).forEach(p => sumarMetodo(this.nombreMetodo(p.metodo), p.monto)));
    webPeriodo.forEach(p => sumarMetodo(this.nombreMetodo(p.pago), num(p.total)));
    const porMetodo = [...metodos.entries()]
      .map(([metodo, x]) => ({ metodo, monto: this.redondear(x.monto), cantidad: x.cantidad }))
      .sort((a, b) => b.monto - a.monto);

    // ---------- Cajeros (local) ----------
    // Desde que existen los cajeros se agrupa por quién cobró; las ventas viejas, por el usuario de la sesión
    const vendedores = new Map<string, { monto: number; tickets: number }>();
    vigentes.filter(v => !esCobroDeuda(v)).forEach(v => {
      const nombre = v.cajero
        ? [v.cajero.nombre, v.cajero.apellido].filter(Boolean).join(' ')
        : (v.usuario?.nombre || v.usuario?.usuario || 'Sin registrar') + (v.usuario ? ' (usuario)' : '');
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
      // ↩ Las notas de devolución restan del total pero no son tickets de venta
      ticketsLocal: ventasProductos.filter(v => v.tipoVenta !== 'devolucion').length,
      ticketPromedio: ventasProductos.some(v => v.tipoVenta !== 'devolucion')
        ? this.redondear(ventasLocal / ventasProductos.filter(v => v.tipoVenta !== 'devolucion').length) : 0,
      anuladosLocal: ventasPeriodo.length - vigentes.length,
      ventasWeb: this.redondear(ventasWeb),
      pedidosWeb: webPeriodo.length,
      reparacionesCobradas: this.redondear(reparacionesCobradas),
      cobrosReparacion: reparaciones.length,
      reparacionesManoObra: desgloseReparaciones.manoObra,
      reparacionesRepuestos: desgloseReparaciones.repuestos,
      reparacionesSinDiscriminar: desgloseReparaciones.sinDiscriminar,
      ventasACuenta: this.redondear(this.sumar(vigentes, v => aCuentaDeVenta(v))),
      cobrosCuenta: this.redondear(this.sumar(cobrosCuentaPeriodo, v => v.total)),
      cantidadCobrosCuenta: cobrosCuentaPeriodo.length,
      ventasACredito: this.redondear(this.sumar(ventasCredito, v => creditoDeVenta(v))),
      cantidadVentasCredito: ventasCredito.length,
      cobrosCuotas: this.redondear(this.sumar(cobrosCuotasPeriodo, v => v.total)),
      cantidadCobrosCuotas: cobrosCuotasPeriodo.length,
      recargosCuotas: this.redondear(this.sumar(cobrosCuotasPeriodo, v => v.cuotaCredito?.recargo)),
      deudaCreditos: cartera.saldo,
      deudaCreditosVencida: cartera.vencido,
      creditosVigentes: cartera.vigentes,
      creditosConAtraso: cartera.conAtraso,
      ...this.indicadoresEquipos(d, vigentes, webPeriodo),
      deudaCuentas: this.redondear(this.sumar((d.cuentas || []).filter(c => num(c.saldo) > 0.004), c => c.saldo)),
      cuentasConDeuda: (d.cuentas || []).filter(c => num(c.saldo) > 0.004).length,
      egresos: this.redondear(egresos),
      // Con sucursal: su resultado propio (sin la tienda web ni los gastos generales, con el costo de taller)
      resultado: filaElegida ? filaElegida.resultado : this.redondear(totalVendido - egresos),
      ...tTaller,
      deudaInternaTaller,
      hayTaller: !!taller,
      esTallerSeleccionado: !!taller && sucursalId === taller.id,
      porSucursal,
      totalSucursales,
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
  // EQUIPOS
  // =====================================================================

  /** Equipos vendidos en el período (local + web), stock disponible valorizado y reservados por pedidos web */
  private indicadoresEquipos(d: DatosCrudos, ventasLocal: any[], webPeriodo: any[]) {
    const num = (n: any) => Number(n) || 0;
    const dolarJC = num(d.dolarJC) > 0 ? num(d.dolarJC) : d.dolar;
    let equiposVendidos = 0, montoEquiposVendidos = 0;

    // Local: ítems 'equipo' de las ventas vigentes (con el descuento manual de equipos, si hubo)
    for (const v of ventasLocal) {
      const factor = 1 - num(v.porcentajeDescuentoEquipos) / 100;
      for (const i of (v.items || []).filter((x: any) => x.tipo === 'equipo')) {
        equiposVendidos++;
        montoEquiposVendidos += num(i.subtotal) * factor;
      }
    }
    // Web: pedidos finalizados del período
    for (const p of webPeriodo) {
      for (const i of (p.carrito || []).filter((x: any) => x.tipo === 'equipo')) {
        equiposVendidos++;
        montoEquiposVendidos += num(i.precioFinal) * (i.moneda === 'USD' ? (num(i.cotizacionDolar) || dolarJC) : 1);
      }
    }

    const disponibles = (d.equipos || []).filter(e => e.estado === 'disponible');
    const stockEquiposUsd = this.sumar(disponibles.filter(e => e.moneda !== 'ARS'), e => e.precioMinorista);
    const stockEquiposArs = this.sumar(disponibles.filter(e => e.moneda === 'ARS'), e => e.precioMinorista);
    const equiposReservadosWeb = d.pedidosPendientes
      .reduce((a, p) => a + (p.carrito || []).filter((x: any) => x.tipo === 'equipo').length, 0);

    return {
      equiposVendidos,
      montoEquiposVendidos: this.redondear(montoEquiposVendidos),
      equiposDisponibles: disponibles.length,
      stockEquiposUsd: this.redondear(stockEquiposUsd),
      stockEquiposArs: this.redondear(stockEquiposArs),
      stockEquiposPesos: this.redondear(stockEquiposArs + stockEquiposUsd * dolarJC),
      equiposReservadosWeb
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
    if (m.includes('cuenta')) return 'Cuenta corriente';
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
