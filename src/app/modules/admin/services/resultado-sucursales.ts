/**
 * Resultado por sucursal (funciones puras, se prueban sin Angular).
 *
 * Cada sucursal vende (productos + cobros de reparaciones) y tiene sus gastos de caja.
 * Además, entre el LOCAL y el TALLER hay trabajos internos: cuando el taller termina una
 * reparación le carga su costo al local (ver despacho/services/cuenta-taller.ts).
 *   - Para el local es un COSTO (costo de taller).
 *   - Para el taller es un INGRESO (trabajos para el local).
 * En el total del negocio esos cargos se compensan: no suman ni restan.
 *
 * La tienda web no tiene sucursal y los gastos generales tampoco: van en filas aparte,
 * así la suma de las filas da el resultado total del negocio.
 */

export interface TrabajoTaller {
  id: string;                     // id del cargo (orden_{ordenId})
  cuentaId: string;
  fecha: string;                  // ISO: cuándo el taller dio el trabajo por terminado
  importe: number;                // costo del taller
  pendiente: number;              // lo que falta pagarle al taller
  presupuesto: number;            // lo que se le cobra al cliente
  numeroOrden: any;
  equipo: string;
  cliente: string;
  nota?: string;
  deudor: { id: string; nombre: string };    // el local
  acreedor: { id: string; nombre: string };  // el taller
}

export interface FilaSucursal {
  id: string;
  nombre: string;
  tipo: 'sucursal' | 'taller' | 'web' | 'generales' | 'otras';
  ventas: number;                 // productos (y equipos) vendidos en el local
  reparaciones: number;           // cobros de reparaciones a clientes
  web: number;                    // solo la fila de la tienda web
  trabajosParaLocal: number;      // + lo que el taller le cargó al local
  costoTaller: number;            // − lo que el local le debe al taller por las reparaciones
  egresos: number;                // − gastos y proveedores de caja (sin los pagos internos)
  resultado: number;
  tickets: number;
  trabajos: number;               // cantidad de trabajos internos (como local o como taller)
}

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const num = (n: any) => Number(n) || 0;

/** Cargos vigentes de la cuenta Local–Taller con fecha dentro del período */
export function trabajosDelPeriodo(movs: any[], inicio: Date, fin: Date): TrabajoTaller[] {
  return (movs || [])
    .filter(m => m && m.tipo === 'cargo' && m.anulado !== true && num(m.importe) > 0)
    .filter(m => { const f = new Date(m.fecha); return !isNaN(f.getTime()) && f >= inicio && f <= fin; })
    .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
}

/** Costo de taller (como local) y trabajos (como taller) para una sucursal, o para todas */
export function totalesTaller(trabajos: TrabajoTaller[], sucursalId: string | null) {
  const lista = trabajos || [];
  const comoLocal = lista.filter(t => !sucursalId || t.deudor?.id === sucursalId);
  const comoTaller = lista.filter(t => !sucursalId || t.acreedor?.id === sucursalId);
  const costo = r2(comoLocal.reduce((a, t) => a + num(t.importe), 0));
  const presupuesto = r2(comoLocal.reduce((a, t) => a + num(t.presupuesto), 0));
  return {
    costoTaller: costo,                                              // lo que el local le debe al taller
    cantidadTrabajos: comoLocal.length,
    presupuestoTrabajos: presupuesto,                                // lo que se les cobra a los clientes por esas órdenes
    gananciaTrabajos: r2(presupuesto - costo),                       // lo que le queda al local en esas órdenes
    trabajosParaLocal: r2(comoTaller.reduce((a, t) => a + num(t.importe), 0)),
    cantidadTrabajosTaller: comoTaller.length
  };
}

export interface EntradaFilas {
  sucursales: { id: string; nombre: string; esTaller?: boolean }[];
  ventas: any[];                  // vigentes del período (sin anuladas)
  movimientos: any[];             // MovimientosCaja vigentes del período
  trabajos: TrabajoTaller[];      // del período
  ventasWeb: number;
  pedidosWeb: number;
  gastosGenerales: number;
}

/**
 * Una fila por sucursal + tienda web + gastos generales (+ "otras" si hay ventas de una
 * sucursal que ya no existe). La suma de "resultado" da el resultado total del negocio.
 */
export function filasPorSucursal(e: EntradaFilas): FilaSucursal[] {
  const conocidas = new Set((e.sucursales || []).map(s => s.id));
  const vacia = (id: string, nombre: string, tipo: FilaSucursal['tipo']): FilaSucursal => ({
    id, nombre, tipo, ventas: 0, reparaciones: 0, web: 0, trabajosParaLocal: 0, costoTaller: 0,
    egresos: 0, resultado: 0, tickets: 0, trabajos: 0
  });

  const filas = new Map<string, FilaSucursal>();
  (e.sucursales || []).forEach(s => filas.set(s.id, vacia(s.id, s.nombre, s.esTaller ? 'taller' : 'sucursal')));
  const otras = vacia('__otras', 'Otras / sin sucursal', 'otras');
  const fila = (id: any) => (id && conocidas.has(id) ? filas.get(id)! : otras);

  for (const v of e.ventas || []) {
    if (v.tipoVenta === 'cobrocuenta' || v.tipoVenta === 'cobrocuota' || v.tipoVenta === 'refinanciacion') continue;   // cobrar una deuda no es una venta nueva
    const f = fila(v.sucursalId);
    if (v.tipoVenta === 'reparacion') f.reparaciones += num(v.total);
    else { f.ventas += num(v.total); if (v.tipoVenta !== 'devolucion') f.tickets++; }   // ↩ la devolución resta (total negativo)
  }
  for (const m of e.movimientos || []) {
    if (m.interno === true) continue;                      // pagos entre el local y el taller
    if (m.tipo !== 'gasto' && m.tipo !== 'proveedor') continue;
    fila(m.sucursalId).egresos += num(m.importe);
  }
  for (const t of e.trabajos || []) {
    const local = fila(t.deudor?.id), taller = fila(t.acreedor?.id);
    local.costoTaller += num(t.importe); local.trabajos++;
    taller.trabajosParaLocal += num(t.importe); taller.trabajos++;
  }

  const resultado = (f: FilaSucursal) => {
    f.ventas = r2(f.ventas); f.reparaciones = r2(f.reparaciones); f.egresos = r2(f.egresos);
    f.costoTaller = r2(f.costoTaller); f.trabajosParaLocal = r2(f.trabajosParaLocal);
    f.resultado = r2(f.ventas + f.reparaciones + f.web + f.trabajosParaLocal - f.costoTaller - f.egresos);
    return f;
  };

  const lista = [...filas.values()].map(resultado);
  const web = vacia('__web', 'Tienda web', 'web');
  web.web = r2(e.ventasWeb); web.tickets = e.pedidosWeb || 0;
  lista.push(resultado(web));
  if (num(e.gastosGenerales)) {
    const g = vacia('__generales', 'Gastos generales', 'generales');
    g.egresos = r2(e.gastosGenerales);
    lista.push(resultado(g));
  }
  const tieneAlgo = (f: FilaSucursal) => f.ventas || f.reparaciones || f.egresos || f.costoTaller || f.trabajosParaLocal;
  if (tieneAlgo(otras)) lista.push(resultado(otras));
  return lista;
}

/** Fila de totales (los trabajos internos se compensan entre el local y el taller) */
export function totalFilas(filas: FilaSucursal[]): FilaSucursal {
  const t: FilaSucursal = {
    id: '__total', nombre: 'Total del negocio', tipo: 'sucursal', ventas: 0, reparaciones: 0, web: 0,
    trabajosParaLocal: 0, costoTaller: 0, egresos: 0, resultado: 0, tickets: 0, trabajos: 0
  };
  for (const f of filas || []) {
    t.ventas += f.ventas; t.reparaciones += f.reparaciones; t.web += f.web;
    t.trabajosParaLocal += f.trabajosParaLocal; t.costoTaller += f.costoTaller;
    t.egresos += f.egresos; t.resultado += f.resultado; t.tickets += f.tickets;
  }
  (['ventas', 'reparaciones', 'web', 'trabajosParaLocal', 'costoTaller', 'egresos', 'resultado'] as const)
    .forEach(k => t[k] = r2(t[k]));
  t.trabajos = 0;
  return t;
}
