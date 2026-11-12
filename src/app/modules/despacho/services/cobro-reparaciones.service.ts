import { Injectable } from '@angular/core';
import {
  Firestore,
  collection,
  doc,
  query,
  where,
  getDocs,
  runTransaction,
  serverTimestamp
} from '@angular/fire/firestore';
import { AuditoriaService } from 'src/app/shared/services/auditoria.service';
import { TicketsService } from './tickets.service';
import { PagoVenta, metodoResumen, limpiarDetalle } from './pagos';
import { CajeroVenta, nombreCajero } from 'src/app/modules/admin/services/cajeros.service';
import { DesgloseCobro, imputarCobroReparacion, repartirCobroOrdenes, sumarDesgloses } from './desglose-reparacion';

/** Medios a los que se les puede hacer descuento al cobrar una reparación */
export const METODOS_CON_DESCUENTO_REPARACION = ['efectivo', 'transferencia'];

/** Cuántas órdenes se pueden cobrar juntas en un mismo ticket */
export const MAX_ORDENES_POR_COBRO = 15;

/** Colecciones donde puede estar una orden de taller */
export const COLECCIONES_ORDENES = ['Ordenes Pendientes', 'Ordenes Finalizadas'];

/** Un cobro registrado en la orden */
export interface CobroOrden {
  ventaId: string;
  nroTicket: number;
  monto: number;                 // lo que se descuenta del saldo de la orden (incluye el descuento)
  cobrado?: number;              // lo que efectivamente pagó (si hubo descuento)
  descuento?: number;            // descuento por efectivo / transferencia
  metodoPago: string;            // el medio, o 'mixto'
  pagos?: PagoVenta[];           // detalle si pagó con varios medios
  fecha: string;
  usuario: { uid: string; usuario: string; nombre: string };
  cajero?: CajeroVenta | null;   // quién cobró
  anulado?: boolean;
  desglose?: DesgloseCobro | null; // mano de obra / repuestos (null: orden sin discriminar)
}

export class CobroReparacionError extends Error {
  constructor(message: string) {
    super(message);
  }
}

/**
 * Cobro de reparaciones del taller desde despacho.
 *  - Permite cobros parciales (seña + saldo).
 *  - Cada cobro genera una venta/ticket del tipo 'reparacion' (entra en la caja y en el cierre).
 *  - Opcionalmente entrega el equipo (pasa la orden a 'Ordenes Finalizadas').
 */
@Injectable({ providedIn: 'root' })
export class CobroReparacionesService {

  constructor(
    private firestore: Firestore,
    private auditoria: AuditoriaService,
    private tickets: TicketsService
  ) { }

  // =====================================================
  // BÚSQUEDA
  // =====================================================

  async buscarPorNumero(numeroOrden: number): Promise<any[]> {
    return this.buscar('numeroOrden', numeroOrden);
  }

  async buscarPorDni(dni: number): Promise<any[]> {
    // El DNI puede estar guardado como número o como texto
    const [comoNumero, comoTexto] = await Promise.all([
      this.buscar('dniCliente', dni),
      this.buscar('dniCliente', String(dni))
    ]);
    const vistos = new Set<string>();
    return [...comoNumero, ...comoTexto].filter(o => {
      const clave = `${o.coleccion}/${o.id}`;
      if (vistos.has(clave)) return false;
      vistos.add(clave);
      return true;
    });
  }

  private async buscar(campo: string, valor: any): Promise<any[]> {
    const resultados = await Promise.all(COLECCIONES_ORDENES.map(async col => {
      const snap = await getDocs(query(collection(this.firestore, col), where(campo, '==', valor)));
      return snap.docs.map(d => ({ id: d.id, coleccion: col, ...d.data() }));
    }));
    return resultados.flat().sort((a: any, b: any) => (b.numeroOrden || 0) - (a.numeroOrden || 0));
  }

  // =====================================================
  // SALDOS
  // =====================================================

  totalPagado(orden: any): number {
    return this.redondear((orden?.cobros || [])
      .filter((c: CobroOrden) => !c.anulado)
      .reduce((acc: number, c: CobroOrden) => acc + (Number(c.monto) || 0), 0));
  }

  saldo(orden: any): number {
    return this.redondear(Math.max(0, (Number(orden?.presupuesto) || 0) - this.totalPagado(orden)));
  }

  // =====================================================
  // COBRO
  // =====================================================

  /**
   * Registra el cobro en una sola transacción:
   *  venta/ticket (numerado) + cobro en la orden + contador de la caja + auditoría
   *  (+ pasa la orden a Finalizadas si se entrega el equipo).
   *  Puede pagarse con uno o varios medios (pagos); las reparaciones no tienen descuento por medio de pago.
   */
  /**
   * Descuento manual (efectivo / transferencia): el cliente paga menos y se cancela el saldo igual.
   * Ej: saldo $100.000, 10% en efectivo → paga $90.000 y la orden queda cancelada.
   * pagosIngresados.monto = lo que paga con ese medio; descuento = lo que cancela de más.
   */
  async cobrar(
    caja: any,
    orden: any,
    pagosIngresados: { metodo: string; monto: number; porcentajeDescuento?: number; descuento?: number; detalle?: string }[],
    entregar: boolean,
    cajero: CajeroVenta | null,
    efectivo: { efectivoRecibido: number | null; vuelto: number | null } = { efectivoRecibido: null, vuelto: null }
  ): Promise<{ venta: any; saldoRestante: number; entregada: boolean }> {
    const r = await this.cobrarOrdenes(caja, [orden], pagosIngresados, entregar ? [orden.id] : [], cajero, efectivo);
    return { venta: r.venta, saldoRestante: r.saldoRestante, entregada: r.entregadas.length > 0 };
  }

  /**
   * Cobra una o varias órdenes del mismo cliente (mismo DNI / CUIT) con un solo ticket.
   * Con varias, todas se cancelan completas menos la última (la de número más alto), que puede quedar con saldo.
   * @param entregarIds órdenes pendientes cuyo equipo se entrega (pasan a Finalizadas)
   */
  async cobrarOrdenes(
    caja: any,
    ordenesIngresadas: any[],
    pagosIngresados: { metodo: string; monto: number; porcentajeDescuento?: number; descuento?: number; detalle?: string }[],
    entregarIds: string[],
    cajero: CajeroVenta | null,
    efectivo: { efectivoRecibido: number | null; vuelto: number | null } = { efectivoRecibido: null, vuelto: null }
  ): Promise<{ venta: any; saldoRestante: number; entregadas: number[] }> {

    const usuario = this.auditoria.getUsuarioActual();
    if (!usuario) throw new CobroReparacionError('No se pudo identificar al usuario. Volvé a iniciar sesión.');
    if (!caja?.id) throw new CobroReparacionError('No hay una caja abierta.');
    if (!cajero?.id) throw new CobroReparacionError('Elegí el cajero que cobra.');

    // Órdenes: sin repetir, de la más vieja a la más nueva
    const vistas = new Set<string>();
    const ordenes = (ordenesIngresadas || []).filter(o => {
      if (!o?.id || vistas.has(o.id)) return false;
      vistas.add(o.id);
      return true;
    }).sort((a, b) => (Number(a.numeroOrden) || 0) - (Number(b.numeroOrden) || 0));
    if (!ordenes.length) throw new CobroReparacionError('Elegí la orden a cobrar.');
    if (ordenes.length > MAX_ORDENES_POR_COBRO) throw new CobroReparacionError(`Se pueden cobrar hasta ${MAX_ORDENES_POR_COBRO} órdenes juntas.`);
    const varias = ordenes.length > 1;
    if (varias) {
      const doc0 = String(ordenes[0].dniCliente ?? '').trim();
      if (!doc0 || ordenes.some(o => String(o.dniCliente ?? '').trim() !== doc0)) {
        throw new CobroReparacionError('Solo se pueden cobrar juntas órdenes del mismo cliente (mismo DNI / CUIT).');
      }
    }
    const entregar = new Set(entregarIds || []);

    const pagos: PagoVenta[] = (pagosIngresados || []).map(p => {
      const pct = METODOS_CON_DESCUENTO_REPARACION.includes(p.metodo) ? Math.max(0, Number(p.porcentajeDescuento) || 0) : 0;
      return {
        metodo: p.metodo as any,
        monto: this.redondear(Number(p.monto) || 0),
        porcentajeDescuento: pct,
        descuento: pct > 0 ? this.redondear(Number(p.descuento) || 0) : 0,
        ...(limpiarDetalle(p.detalle) ? { detalle: limpiarDetalle(p.detalle) } : {})   // nº de operación (tarjeta)
      };
    });
    if (!pagos.length || pagos.some(p => !p.metodo)) throw new CobroReparacionError('Elegí el método de pago.');
    if (pagos.some(p => !(p.monto > 0))) throw new CobroReparacionError('Cada medio de pago tiene que tener un monto mayor a 0.');
    for (const p of pagos.filter(x => x.porcentajeDescuento > 0)) {
      if (p.porcentajeDescuento >= 100) throw new CobroReparacionError('El descuento tiene que ser menor al 100%.');
      // El descuento tiene que corresponder al % (con margen de redondeo a centavos)
      const esperado = p.monto / (1 - p.porcentajeDescuento / 100) - p.monto;
      const margen = 0.02 + 0.01 / (1 - p.porcentajeDescuento / 100);
      if (p.descuento < 0 || Math.abs(p.descuento - esperado) > margen) {
        throw new CobroReparacionError('El descuento no coincide con el porcentaje. Volvé a cargar el cobro.');
      }
    }
    const cobrado = this.redondear(pagos.reduce((a, p) => a + p.monto, 0));     // lo que entra a la caja
    const descuento = this.redondear(pagos.reduce((a, p) => a + p.descuento, 0));
    const importe = this.redondear(cobrado + descuento);                         // lo que se descuenta del saldo
    if (!(importe > 0)) throw new CobroReparacionError('El monto tiene que ser mayor a 0.');
    const metodoPago = metodoResumen(pagos);
    const pctTexto = pagos.find(p => p.descuento > 0)?.porcentajeDescuento;
    const textoPagos = (pagos.length === 1
      ? metodoPago
      : pagos.map(p => `${p.metodo} $${p.monto.toFixed(2)}`).join(' + ')) +
      (descuento > 0 ? `, descuento ${pctTexto}%: $${descuento.toFixed(2)}` : '');

    const ordenRefs = ordenes.map(o => doc(this.firestore, o.coleccion, o.id));
    const cajaRef = doc(this.firestore, 'Cajas', caja.id);
    const contadorRef = this.tickets.refContador();
    const ventaRef = doc(collection(this.firestore, 'Ventas'));

    const primera = ordenes[0];
    const nombreCliente = [primera.nombreCliente, primera.apellidoCliente].filter(Boolean).join(' ') || 'Cliente';
    const numeros = ordenes.map(o => '#' + o.numeroOrden).join(', ');
    const seEntrega = ordenes.filter(o => entregar.has(o.id) && o.coleccion === 'Ordenes Pendientes');

    const venta: any = {
      fecha: new Date().toISOString(),
      tipoVenta: 'reparacion',
      tipoPrecio: 'minorista',
      cliente: {
        id: primera.idCliente || null,
        dni: primera.dniCliente ?? null,
        nombre: nombreCliente,
        tipo: 'minorista'
      },
      // La primera orden (los tickets de una sola orden siguen igual que siempre)
      orden: {
        id: primera.id,
        numeroOrden: primera.numeroOrden ?? null,
        equipo: primera.equipo || '',
        imei: primera.imei || ''
      },
      items: [],                         // se arman en la transacción (con los saldos actuales)
      subtotal: importe,                 // saldo que se cancela
      descuentoPago: descuento,          // descuento por efectivo / transferencia
      porcentajeDescuentoPago: pagos.length === 1 && descuento > 0 ? pagos[0].porcentajeDescuento : null,
      total: cobrado,                    // lo que efectivamente pagó (entra a la caja)
      metodoPago,
      pagos,
      sucursalId: caja.sucursalId,
      cajaId: caja.id,
      usuario,
      cajero,
      efectivoRecibido: efectivo.efectivoRecibido ?? null, // con cuánto pagó la parte en efectivo
      vuelto: efectivo.vuelto ?? null,                     // solo informativo
      nroTicket: null
    };

    const registro = await this.auditoria.armarRegistro({
      accion: 'venta',
      entidad: 'Ventas',
      entidadId: ventaRef.id,
      descripcion: `Cobro de reparación ${varias ? 'órdenes' : 'orden'} ${numeros} por $${cobrado.toFixed(2)}` +
        (descuento > 0 ? ` (cancela $${importe.toFixed(2)} del saldo)` : '') + ` (${textoPagos})` +
        (seEntrega.length ? (varias ? ` y entrega de ${seEntrega.map(o => '#' + o.numeroOrden).join(', ')}` : ' y entrega del equipo') : '') +
        ` · cobró ${nombreCajero(cajero)}`,
      extra: {
        ordenId: primera.id, numeroOrden: primera.numeroOrden,
        ...(varias ? { ordenes: ordenes.map(o => o.numeroOrden) } : {}),
        monto: importe, cobrado, descuento, metodoPago,
        pagos: pagos.map(p => `${p.metodo}: ${p.monto}${p.detalle ? ` (${p.detalle})` : ""}`),
        entregar: varias ? seEntrega.map(o => o.numeroOrden) : seEntrega.length > 0
      }
    });
    const descripcionBase = registro?.descripcion || '';

    let saldoRestante = 0;
    let entregadas: number[] = [];

    await runTransaction(this.firestore, async (tx) => {
      // ---------- Lecturas ----------
      const ordenSnaps = [];
      for (const ref of ordenRefs) ordenSnaps.push(await tx.get(ref));
      const cajaSnap = await tx.get(cajaRef);
      const contadorSnap = await tx.get(contadorRef);

      const datos: any[] = ordenSnaps.map((snap, i) => {
        if (!snap.exists()) {
          throw new CobroReparacionError(varias
            ? `La orden #${ordenes[i].numeroOrden} ya no está en ${ordenes[i].coleccion}. Volvé a buscarla.`
            : 'La orden ya no está en ' + ordenes[i].coleccion + '. Volvé a buscarla.');
        }
        return snap.data();
      });

      const datosCaja: any = cajaSnap.exists() ? cajaSnap.data() : null;
      if (!datosCaja || datosCaja.abierta === false) {
        throw new CobroReparacionError('La caja está cerrada. Abrí una caja para cobrar.');
      }

      // ---------- Validación de los saldos (con los datos actuales de las órdenes) ----------
      const saldos = datos.map(d => this.saldo(d));
      saldos.forEach((sal, i) => {
        if (sal <= 0) {
          throw new CobroReparacionError(varias ? `La orden #${ordenes[i].numeroOrden} ya está totalmente pagada.` : 'Esta orden ya está totalmente pagada.');
        }
      });
      const totalSaldos = this.redondear(saldos.reduce((a, x) => a + x, 0));
      if (importe > totalSaldos + 0.009) {
        throw new CobroReparacionError(varias
          ? `El monto supera el saldo pendiente de las órdenes (${this.moneda(totalSaldos)}).`
          : `El monto supera el saldo pendiente (${this.moneda(totalSaldos)}).`);
      }
      const reparto = repartirCobroOrdenes(saldos, importe, descuento);
      if (!reparto.partes) throw new CobroReparacionError(reparto.error || 'No se pudo repartir el cobro.');
      const partes = reparto.partes;
      saldoRestante = this.redondear(totalSaldos - importe);

      // ---------- Mano de obra / repuestos de cada orden ----------
      const desgloses = partes.map((p, i) => imputarCobroReparacion(datos[i], p.importe, p.descuento));
      venta.desglose = varias
        ? sumarDesgloses(partes.map((p, i) => ({ desglose: desgloses[i], cobrado: p.cobrado })))
        : desgloses[0];
      venta.items = ordenes.map((o, i) => ({
        productoId: null,
        tipo: 'reparacion',
        nombre: `Reparación orden #${o.numeroOrden} - ${datos[i].equipo || o.equipo || 'equipo'}`,
        cantidad: 1,
        precioUnitario: partes[i].importe,
        subtotal: partes[i].importe
      }));
      if (varias) {
        venta.ordenes = ordenes.map((o, i) => ({
          id: o.id,
          numeroOrden: o.numeroOrden ?? null,
          equipo: datos[i].equipo || o.equipo || '',
          imei: datos[i].imei || o.imei || '',
          monto: partes[i].importe,
          cobrado: partes[i].cobrado,
          descuento: partes[i].descuento,
          saldoRestante: this.redondear(saldos[i] - partes[i].importe),
          entregada: entregar.has(o.id) && o.coleccion === 'Ordenes Pendientes'
        }));
      }

      // ---------- Escrituras ----------
      const ultimo = contadorSnap.exists() ? (Number((contadorSnap.data() as any).valor) || 0) : 0;
      venta.nroTicket = ultimo + 1;
      venta.saldoRestante = saldoRestante;
      tx.set(contadorRef, { valor: venta.nroTicket }, { merge: true });
      tx.set(ventaRef, venta);

      entregadas = [];
      ordenes.forEach((o, i) => {
        const datosOrden = datos[i];
        const cobro: CobroOrden = {
          ventaId: ventaRef.id,
          nroTicket: venta.nroTicket,
          monto: partes[i].importe,
          cobrado: partes[i].cobrado,
          descuento: partes[i].descuento,
          metodoPago,
          pagos,
          fecha: venta.fecha,
          usuario,
          cajero,
          anulado: false,
          desglose: desgloses[i]
        };
        const cobros = [...(datosOrden.cobros || []), cobro];
        const restante = this.redondear(saldos[i] - partes[i].importe);
        const datosPago = {
          cobros,
          totalPagado: this.redondear(this.totalPagado({ cobros })),
          pagada: restante <= 0
        };

        if (entregar.has(o.id) && o.coleccion === 'Ordenes Pendientes') {
          // Misma lógica que "Finalizar" en el taller: se mueve a Finalizadas
          tx.set(doc(this.firestore, 'Ordenes Finalizadas', o.id), {
            ...datosOrden,
            ...datosPago,
            estado: 'Finalizado',
            fechaEntrega: new Date()
          });
          tx.delete(ordenRefs[i]);
          entregadas.push(o.numeroOrden);
        } else {
          tx.update(ordenRefs[i], datosPago);
        }
      });

      tx.update(cajaRef, { cantidadVentas: (Number(datosCaja.cantidadVentas) || 0) + 1 });

      if (registro) {
        registro.descripcion = `Ticket #${this.tickets.numeroFormateado(venta)} - ${descripcionBase}`;
      }
      this.auditoria.registrarEnTransaccion(tx, registro);
    });

    return { venta: { ...venta, id: ventaRef.id }, saldoRestante, entregadas };
  }

  private moneda(n: number): string {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(Number(n) || 0);
  }

  private redondear(n: number): number {
    return Math.round((Number(n) || 0) * 100) / 100;
  }
}
