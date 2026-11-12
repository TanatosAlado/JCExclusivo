import { Injectable } from '@angular/core';
import {
  Firestore,
  Transaction,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  runTransaction,
  serverTimestamp,
  setDoc
} from '@angular/fire/firestore';
import { AuditoriaService, UsuarioRegistro } from 'src/app/shared/services/auditoria.service';
import { CajeroVenta, nombreCajero } from 'src/app/modules/admin/services/cajeros.service';
import { PagoVenta, metodoResumen, limpiarDetalle, METODOS_SIN_DINERO } from './pagos';
import {
  AplicacionCuota, CuotaCredito, imputarCuotas, revertirCuotas, saldoCuotas, PLANES_INICIALES, PlanCuotas, validarPlanes,
  BloqueoCredito, CartaDocumento, DatosCreditoManual, validarCreditoManual, fechaCorta, calcularRefinanciacion, reimputarPagos
} from './credito-casa';

/** Planes de cuotas e interés (ConfiguracionCreditos/planes) */
export interface ConfigPlanes {
  planes: PlanCuotas[];
  actualizado: { fecha: string; usuario: string } | null;
  guardados: boolean;      // false = todavía se usan los iniciales (nunca se guardaron)
}

/** Crédito de la casa (Creditos/{ventaId}) */
export interface Credito {
  id: string;
  ventaId: string;
  nroTicket: number | null;
  fecha: string;
  sucursalId: string | null;
  cliente: { id: string; nombre: string; dni: any; telefono: string; direccion: string };
  detalle: string;
  equipos: { nombre: string; imei: string }[];
  precioContado: number;
  precioFinanciado: number;
  recargo: number;          // interés en pesos (en los créditos viejos: financiado − contado)
  interes?: number;         // % del plan (desde que hay planes)
  aFinanciar?: number;      // contado − canje − entrega, sin interés
  canje: { monto: number; detalle: string; equipoId?: string } | null;
  entrega: number;
  importe: number;          // lo financiado
  saldo: number;            // lo que falta
  pagado: number;
  cantidadCuotas: number;
  cuotas: CuotaCredito[];
  estado: 'vigente' | 'cancelado' | 'anulado' | 'refinanciado';
  ultimoPago?: string | null;
  anulado?: any;
  /** 'manual' = cargado en Gestiones (crédito dado antes del sistema): no tiene ticket de venta.
   *  'refinanciacion' = crédito nuevo que reemplaza el saldo de otro (creditoAnterior) */
  origen?: 'manual' | 'refinanciacion';
  creditoAnterior?: { id: string; nroTicket: number | null; fecha: string; saldo: number; recargo: number; entrega: number } | null;
  /** Si se refinanció: el crédito nuevo que lo reemplaza */
  refinanciado?: { fecha: string; creditoNuevoId: string; nroTicket: number | null; saldo: number; recargo: number; entrega: number; usuario?: any } | null;
  cargado?: { fecha: string; usuario: string };
  editado?: { fecha: string; usuario: string; antes?: any };
  cartasDocumento?: CartaDocumento[];
  bloqueo?: BloqueoCredito | null;
  ultimoDesbloqueo?: BloqueoCredito | null;
}

/** Pago de cuotas (Creditos/{id}/Pagos/{ventaId del ticket del cobro}) */
export interface PagoCredito {
  id: string;
  ventaId: string;
  nroTicket: number | null;
  fecha: string;
  importe: number;          // capital que cancela (se aplica a las cuotas)
  recargo: number;          // recargo por mora (no baja la deuda)
  cobrado: number;          // importe + recargo (lo que entró a la caja)
  pagos: PagoVenta[];
  aplicaciones: AplicacionCuota[];
  saldoAnterior: number;
  saldoPosterior: number;
  anulado: boolean;
  /** true = pago viejo cargado a mano (de la planilla): no tiene ticket ni pasó por la caja */
  anterior?: boolean;
  nota?: string;
  motivoAnulacion?: string;
}

export class CreditoError extends Error {
  constructor(message: string) {
    super(message);
  }
}

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const texto = (v: any, max = 300) => String(v ?? '').trim().slice(0, max);
/** 'YYYY-MM-DD' → ISO al mediodía (hora local), para que no cambie de día por el huso horario */
const mediodia = (f: string) => { const [a, m, d] = f.split('-').map(Number); return new Date(a, m - 1, d, 12).toISOString(); };
const hoyLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** Lectura para anular el ticket de un cobro de cuotas (fase de lecturas de la transacción) */
export interface LecturaAnulacionCuota {
  creditoRef: any;
  credito: any;
  pagoRef: any;
  pago: any;
}

/**
 * Créditos de la casa: listado, cobro de cuotas en Despacho y su anulación.
 * El cobro es un ticket (Ventas, tipoVenta 'cobrocuota'): entra a la caja y se reimprime desde Tickets.
 */
@Injectable({ providedIn: 'root' })
export class CreditosService {

  constructor(private firestore: Firestore, private auditoria: AuditoriaService) { }

  // =====================================================
  // PLANES DE CUOTAS E INTERÉS
  // =====================================================

  private refPlanes() {
    return doc(this.firestore, 'ConfiguracionCreditos', 'planes');
  }

  /** Planes vigentes (si nunca se guardaron, los iniciales) */
  async planes(): Promise<ConfigPlanes> {
    try {
      const snap = await getDoc(this.refPlanes());
      const datos: any = snap.exists() ? snap.data() : null;
      const v = validarPlanes(datos?.planes || []);
      if (v.planes) return { planes: v.planes, actualizado: datos?.actualizado || null, guardados: true };
    } catch (err) {
      console.warn('No se pudieron leer los planes de cuotas; se usan los iniciales', err);
    }
    return { planes: PLANES_INICIALES.map(p => ({ ...p })), actualizado: null, guardados: false };
  }

  async guardarPlanes(planes: any[]): Promise<PlanCuotas[]> {
    const usuario = this.auditoria.getUsuarioActual();
    if (!usuario) throw new CreditoError('No se pudo identificar al usuario. Volvé a iniciar sesión.');
    const v = validarPlanes(planes);
    if (!v.planes) throw new CreditoError(v.error || 'Revisá los planes.');
    const antes = await this.planes();
    const actualizado = { fecha: new Date().toISOString(), usuario: usuario.nombre || usuario.usuario || '' };
    await setDoc(this.refPlanes(), { planes: v.planes, actualizado });
    const texto = (l: PlanCuotas[]) => l.map(p => `${p.cuotas}: ${p.interes}%`).join(' · ');
    this.auditoria.registrar({
      accion: 'modificar',
      entidad: 'ConfiguracionCreditos',
      entidadId: 'planes',
      descripcion: `Cambió los planes de cuotas del crédito de la casa: ${texto(v.planes)}`,
      antes: { planes: texto(antes.planes) },
      despues: { planes: texto(v.planes) }
    });
    return v.planes;
  }

  refCredito(id: string) {
    return doc(this.firestore, 'Creditos', id);
  }

  /** Créditos con saldo (vigentes), el que debe más viejo primero */
  async vigentes(): Promise<Credito[]> {
    const snap = await getDocs(query(collection(this.firestore, 'Creditos'), where('estado', '==', 'vigente')));
    return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as Credito));
  }

  /** Todos los créditos (vigentes, cancelados y anulados) para Gestiones → Créditos */
  async todos(): Promise<Credito[]> {
    const snap = await getDocs(collection(this.firestore, 'Creditos'));
    return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as Credito));
  }

  async obtener(id: string): Promise<Credito | null> {
    const snap = await getDoc(this.refCredito(id));
    return snap.exists() ? ({ id: snap.id, ...(snap.data() as any) } as Credito) : null;
  }

  /** Pagos de un crédito, del más nuevo al más viejo */
  async pagosDe(creditoId: string): Promise<PagoCredito[]> {
    const snap = await getDocs(collection(this.firestore, 'Creditos', creditoId, 'Pagos'));
    return snap.docs
      .map(d => ({ id: d.id, ...(d.data() as any) } as PagoCredito))
      .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  }

  /** Ticket guardado (para reimprimir un comprobante) */
  async ticket(ventaId: string): Promise<any | null> {
    const snap = await getDoc(doc(this.firestore, 'Ventas', ventaId));
    return snap.exists() ? { id: snap.id, ...(snap.data() as any) } : null;
  }

  // =====================================================
  // COBRO DE CUOTAS
  // =====================================================

  /**
   * Cobra cuotas en una sola transacción:
   *  ticket (Ventas 'cobrocuota', entra a la caja) + cuotas y saldo del crédito + pago del crédito
   *  + contador de la caja + auditoría.
   * @param importe lo que se aplica a las cuotas (la más vieja primero)
   * @param recargo recargo por mora (opcional, lo decide el cajero: entra a la caja pero no baja la deuda)
   */
  async cobrar(
    caja: any,
    creditoId: string,
    importe: number,
    recargo: number,
    pagosIngresados: { metodo: string; monto: number; detalle?: string }[],
    cajero: CajeroVenta | null,
    efectivo: { efectivoRecibido: number | null; vuelto: number | null } = { efectivoRecibido: null, vuelto: null }
  ): Promise<{ venta: any; saldoRestante: number; aplicaciones: AplicacionCuota[]; cancelado: boolean }> {

    const usuario = this.auditoria.getUsuarioActual();
    if (!usuario) throw new CreditoError('No se pudo identificar al usuario. Volvé a iniciar sesión.');
    if (!caja?.id) throw new CreditoError('No hay una caja abierta.');
    if (!cajero?.id) throw new CreditoError('Elegí el cajero que cobra.');

    const capital = r2(importe);
    const mora = r2(recargo);
    if (!(capital > 0)) throw new CreditoError('El monto a pagar tiene que ser mayor a 0.');
    if (mora < 0) throw new CreditoError('El recargo no puede ser negativo.');
    const cobrado = r2(capital + mora);

    const pagos: PagoVenta[] = (pagosIngresados || []).map(p => ({
      metodo: p.metodo as any,
      monto: r2(p.monto),
      porcentajeDescuento: 0,
      descuento: 0,
      ...(limpiarDetalle(p.detalle) ? { detalle: limpiarDetalle(p.detalle) } : {})
    }));
    if (!pagos.length || pagos.some(p => !p.metodo)) throw new CreditoError('Elegí el método de pago.');
    if (pagos.some(p => METODOS_SIN_DINERO.includes(p.metodo as any))) {
      throw new CreditoError('Las cuotas se pagan con efectivo, tarjeta o transferencia.');
    }
    if (pagos.some(p => !(p.monto > 0))) throw new CreditoError('Cada medio de pago tiene que tener un monto mayor a 0.');
    if (Math.abs(r2(pagos.reduce((a, p) => a + p.monto, 0)) - cobrado) > 0.009) {
      throw new CreditoError('Los medios de pago no suman lo que hay que cobrar. Volvé a cargar el cobro.');
    }

    const creditoRef = this.refCredito(creditoId);
    const cajaRef = doc(this.firestore, 'Cajas', caja.id);
    const contadorRef = doc(this.firestore, 'Contador Tickets', 'general');
    const ventaRef = doc(collection(this.firestore, 'Ventas'));
    const pagoRef = doc(this.firestore, 'Creditos', creditoId, 'Pagos', ventaRef.id);

    const registro = await this.auditoria.armarRegistro({
      accion: 'venta',
      entidad: 'Ventas',
      entidadId: ventaRef.id,
      descripcion: `Cobro de cuotas del crédito de la casa por $${cobrado.toFixed(2)}` +
        (mora > 0 ? ` (incluye $${mora.toFixed(2)} de recargo por mora)` : '') +
        ` (${pagos.length === 1 ? pagos[0].metodo : pagos.map(p => `${p.metodo} $${p.monto.toFixed(2)}`).join(' + ')})` +
        ` · cobró ${nombreCajero(cajero)}`,
      extra: { creditoId, capital, recargo: mora, cobrado, pagos: pagos.map(p => `${p.metodo}: ${p.monto}${p.detalle ? ` (${p.detalle})` : ''}`) }
    });
    const descripcionBase = registro?.descripcion || '';

    let venta: any = null;
    let saldoRestante = 0;
    let aplicaciones: AplicacionCuota[] = [];

    await runTransaction(this.firestore, async (tx) => {
      // ---------- Lecturas ----------
      const creditoSnap = await tx.get(creditoRef);
      const cajaSnap = await tx.get(cajaRef);
      const contadorSnap = await tx.get(contadorRef);

      const datosCaja: any = cajaSnap.exists() ? cajaSnap.data() : null;
      if (!datosCaja || datosCaja.abierta === false) {
        throw new CreditoError('La caja está cerrada. Abrí una caja para cobrar.');
      }
      const credito: any = creditoSnap.exists() ? creditoSnap.data() : null;
      if (!credito) throw new CreditoError('El crédito ya no existe.');
      if (credito.estado === 'anulado') throw new CreditoError('Este crédito fue anulado.');
      if (credito.estado === 'refinanciado') throw new CreditoError('Este crédito se refinanció: las cuotas se cobran en el crédito nuevo.');
      const saldoActual = saldoCuotas(credito.cuotas || []);
      if (credito.estado === 'cancelado' || saldoActual <= 0.004) throw new CreditoError('Este crédito ya está cancelado: no debe nada.');
      if (capital > saldoActual + 0.009) {
        throw new CreditoError(`El monto supera lo que debe el cliente (${this.moneda(saldoActual)}).`);
      }

      // ---------- Imputación (la cuota más vieja primero, con los datos actuales) ----------
      const imp = imputarCuotas(credito.cuotas || [], capital);
      if (imp.sobrante > 0.009) {
        throw new CreditoError('El crédito cambió mientras se cobraba. Volvé a abrirlo e intentá de nuevo.');
      }
      aplicaciones = imp.aplicaciones;
      saldoRestante = saldoCuotas(imp.cuotas);
      const cancelado = saldoRestante <= 0.004;

      // ---------- Escrituras ----------
      const fecha = new Date().toISOString();
      const nroTicket = (contadorSnap.exists() ? (Number((contadorSnap.data() as any).valor) || 0) : 0) + 1;
      const textoCuotas = aplicaciones.map(a => a.numero).join(', ');
      venta = {
        fecha,
        tipoVenta: 'cobrocuota',
        tipoPrecio: 'minorista',
        cliente: { id: credito.cliente.id, dni: credito.cliente.dni ?? null, nombre: credito.cliente.nombre, tipo: 'minorista' },
        items: [
          {
            productoId: null,
            tipo: 'cuota',
            nombre: `Pago crédito de la casa · cuota${aplicaciones.length > 1 ? 's' : ''} ${textoCuotas} de ${credito.cantidadCuotas}`,
            cantidad: 1,
            precioUnitario: capital,
            subtotal: capital
          },
          ...(mora > 0 ? [{ productoId: null, tipo: 'recargo', nombre: 'Recargo por pago fuera de término', cantidad: 1, precioUnitario: mora, subtotal: mora }] : [])
        ],
        subtotal: cobrado,
        total: cobrado,                    // entra a la caja
        metodoPago: metodoResumen(pagos),
        pagos,
        sucursalId: caja.sucursalId,
        cajaId: caja.id,
        usuario,
        cajero,
        efectivoRecibido: efectivo.efectivoRecibido ?? null,
        vuelto: efectivo.vuelto ?? null,
        nroTicket,
        cuotaCredito: {
          creditoId,
          ventaCredito: credito.ventaId,
          nroTicketCredito: credito.nroTicket ?? null,
          capital,
          recargo: mora,
          aplicaciones,
          cuotas: imp.cuotas.map(c => ({ numero: c.numero, importe: c.importe, pagado: c.pagado, hasta: c.hasta })),
          saldoAnterior: saldoActual,
          saldoPosterior: saldoRestante,
          cantidadCuotas: credito.cantidadCuotas
        }
      };
      tx.set(contadorRef, { valor: nroTicket }, { merge: true });
      tx.set(ventaRef, venta);

      const pago: Omit<PagoCredito, 'id'> & any = {
        ventaId: ventaRef.id,
        nroTicket,
        fecha,
        importe: capital,
        recargo: mora,
        cobrado,
        pagos,
        aplicaciones,
        saldoAnterior: saldoActual,
        saldoPosterior: saldoRestante,
        sucursalId: caja.sucursalId || null,
        cajaId: caja.id,
        usuario,
        cajero,
        anulado: false
      };
      tx.set(pagoRef, pago);

      tx.update(creditoRef, {
        cuotas: imp.cuotas,
        saldo: saldoRestante,
        pagado: r2((Number(credito.importe) || 0) - saldoRestante),
        estado: cancelado ? 'cancelado' : 'vigente',
        ultimoPago: fecha,
        ...(cancelado ? { canceladoEn: fecha } : {})
      });

      tx.update(cajaRef, { cantidadVentas: (Number(datosCaja.cantidadVentas) || 0) + 1 });

      if (registro) {
        registro.descripcion = `Ticket #${String(nroTicket).padStart(8, '0')} - ${descripcionBase} · ${credito.cliente.nombre}, ` +
          `cuota(s) ${textoCuotas}` + (cancelado ? ' · CRÉDITO CANCELADO' : ` · saldo ${this.moneda(saldoRestante)}`);
      }
      this.auditoria.registrarEnTransaccion(tx, registro);
    });

    return { venta: { ...venta, id: ventaRef.id }, saldoRestante, aplicaciones, cancelado: saldoRestante <= 0.004 };
  }

  // =====================================================
  // 🔁 REFINANCIACIÓN
  // =====================================================

  /**
   * Refinancia el saldo de un crédito (más el recargo por atraso, que el cajero puede bajar o borrar),
   * descontando la entrega que paga ahora, con el interés del plan elegido. Todo en una transacción:
   *  - ticket 'refinanciacion' (la entrega entra a la caja; se imprime el plan nuevo para firmar),
   *  - crédito nuevo (mismo cliente y equipo; si el viejo estaba bloqueado, sigue bloqueado),
   *  - el crédito viejo queda 'refinanciado' (no suma más en la cartera ni como vencido).
   * Se deshace anulando el ticket, si el crédito nuevo todavía no tiene pagos.
   */
  async refinanciar(
    caja: any,
    creditoId: string,
    datos: { recargo: number; entrega: number; plan: PlanCuotas; pagos: { metodo: string; monto: number; detalle?: string }[]; cajero: CajeroVenta | null },
    efectivo: { efectivoRecibido: number | null; vuelto: number | null } = { efectivoRecibido: null, vuelto: null }
  ): Promise<{ venta: any; creditoNuevoId: string }> {
    const usuario = this.auditoria.getUsuarioActual();
    if (!usuario) throw new CreditoError('No se pudo identificar al usuario. Volvé a iniciar sesión.');
    if (!caja?.id) throw new CreditoError('No hay una caja abierta.');
    if (!datos.cajero?.id) throw new CreditoError('Elegí el cajero.');
    const entrega = r2(datos.entrega || 0);
    const recargo = r2(datos.recargo || 0);

    const pagos: PagoVenta[] = entrega > 0 ? (datos.pagos || []).map(p => ({
      metodo: p.metodo as any,
      monto: r2(p.monto),
      porcentajeDescuento: 0,
      descuento: 0,
      ...(limpiarDetalle(p.detalle) ? { detalle: limpiarDetalle(p.detalle) } : {})
    })) : [];
    if (entrega > 0) {
      if (!pagos.length || pagos.some(p => !p.metodo)) throw new CreditoError('Elegí con qué paga la entrega.');
      if (pagos.some(p => METODOS_SIN_DINERO.includes(p.metodo as any))) throw new CreditoError('La entrega se paga con efectivo, tarjeta o transferencia.');
      if (pagos.some(p => !(p.monto > 0))) throw new CreditoError('Cada medio de pago tiene que tener un monto mayor a 0.');
      if (Math.abs(r2(pagos.reduce((a, p) => a + p.monto, 0)) - entrega) > 0.009) {
        throw new CreditoError('Los medios de pago no suman la entrega. Volvé a cargarla.');
      }
    }

    const viejoRef = this.refCredito(creditoId);
    const cajaRef = doc(this.firestore, 'Cajas', caja.id);
    const contadorRef = doc(this.firestore, 'Contador Tickets', 'general');
    const ventaRef = doc(collection(this.firestore, 'Ventas'));
    const nuevoRef = this.refCredito(ventaRef.id);           // el crédito nuevo lleva el id de su ticket
    let venta: any = null;
    let descripcion = '';

    await runTransaction(this.firestore, async (tx) => {
      // ---------- Lecturas ----------
      const viejoSnap = await tx.get(viejoRef);
      const cajaSnap = await tx.get(cajaRef);
      const contadorSnap = await tx.get(contadorRef);
      const datosCaja: any = cajaSnap.exists() ? cajaSnap.data() : null;
      if (!datosCaja || datosCaja.abierta === false) throw new CreditoError('La caja está cerrada. Abrí una caja para refinanciar.');
      const viejo: any = viejoSnap.exists() ? viejoSnap.data() : null;
      if (!viejo) throw new CreditoError('El crédito ya no existe.');
      if (viejo.estado !== 'vigente') {
        throw new CreditoError(viejo.estado === 'refinanciado' ? 'Este crédito ya se refinanció.' : 'Solo se refinancian créditos que todavía deben.');
      }

      // ---------- Cálculo con el saldo actual ----------
      const saldo = saldoCuotas(viejo.cuotas || []);
      const ahora = new Date();
      const { calculo, error } = calcularRefinanciacion(saldo, recargo, entrega, datos.plan, ahora);
      if (!calculo) throw new CreditoError(error || 'Revisá los datos de la refinanciación.');

      // ---------- Escrituras ----------
      const fecha = ahora.toISOString();
      const nroTicket = (contadorSnap.exists() ? (Number((contadorSnap.data() as any).valor) || 0) : 0) + 1;
      const nombreUsuario = this.nombreUsuario(usuario);
      const creditoAnterior = {
        id: creditoId, nroTicket: viejo.nroTicket ?? null, fecha: viejo.fecha || null,
        saldo: calculo.saldo, recargo: calculo.recargo, entrega: calculo.entrega
      };
      venta = {
        fecha,
        tipoVenta: 'refinanciacion',
        tipoPrecio: 'minorista',
        cliente: { id: viejo.cliente?.id || null, dni: viejo.cliente?.dni ?? null, nombre: viejo.cliente?.nombre || 'Cliente', tipo: 'minorista' },
        items: entrega > 0
          ? [{ productoId: null, tipo: 'refinanciacion', nombre: 'Entrega · refinanciación crédito de la casa', cantidad: 1, precioUnitario: entrega, subtotal: entrega }]
          : [],
        subtotal: entrega,
        total: entrega,                              // lo que entra a la caja
        metodoPago: entrega > 0 ? metodoResumen(pagos) : 'sin entrega',
        pagos,
        sucursalId: caja.sucursalId,
        cajaId: caja.id,
        usuario,
        cajero: datos.cajero,
        efectivoRecibido: efectivo.efectivoRecibido ?? null,
        vuelto: efectivo.vuelto ?? null,
        nroTicket,
        refinanciacion: {
          creditoAnterior,
          creditoNuevoId: ventaRef.id,
          saldoAnterior: calculo.saldo,
          recargo: calculo.recargo,
          entrega: calculo.entrega,
          aRefinanciar: calculo.aRefinanciar,
          interes: calculo.interes,
          financiado: calculo.financiado,
          cantidadCuotas: calculo.cuotas.length,
          cuotas: calculo.cuotas.map(q => ({ numero: q.numero, importe: q.importe, desde: q.desde, hasta: q.hasta })),
          equipo: (viejo.equipos || [])[0]?.nombre || viejo.detalle || ''
        }
      };
      const nuevo: any = {
        ventaId: ventaRef.id,
        nroTicket,
        fecha,
        sucursalId: caja.sucursalId || null,
        cliente: viejo.cliente,
        detalle: `Refinanciación del crédito del ${new Date(viejo.fecha).toLocaleDateString('es-AR')}` + (viejo.detalle ? ` · ${viejo.detalle}` : ''),
        equipos: viejo.equipos || [],
        precioContado: calculo.aRefinanciar,
        precioFinanciado: calculo.financiado,
        recargo: r2(calculo.financiado - calculo.aRefinanciar),
        interes: calculo.interes,
        aFinanciar: calculo.aRefinanciar,
        canje: null,
        entrega: calculo.entrega,
        importe: calculo.financiado,
        saldo: calculo.financiado,
        pagado: 0,
        cantidadCuotas: calculo.cuotas.length,
        cuotas: calculo.cuotas,
        estado: 'vigente',
        ultimoPago: null,
        origen: 'refinanciacion',
        creditoAnterior,
        // Si estaba bloqueado (carta documento), sigue bloqueado; las cartas pasan al crédito nuevo
        bloqueo: viejo.bloqueo || null,
        cartasDocumento: Array.isArray(viejo.cartasDocumento) ? viejo.cartasDocumento : []
      };
      tx.set(contadorRef, { valor: nroTicket }, { merge: true });
      tx.set(ventaRef, venta);
      tx.set(nuevoRef, nuevo);
      tx.update(viejoRef, {
        estado: 'refinanciado',
        refinanciado: {
          fecha, creditoNuevoId: ventaRef.id, nroTicket,
          saldo: calculo.saldo, recargo: calculo.recargo, entrega: calculo.entrega, usuario: nombreUsuario
        }
      });
      tx.update(cajaRef, { cantidadVentas: (Number(datosCaja.cantidadVentas) || 0) + 1 });
      descripcion = `Ticket #${String(nroTicket).padStart(8, '0')} - Refinanció el crédito de ${viejo.cliente?.nombre || ''}: ` +
        `saldo ${this.moneda(calculo.saldo)}` + (calculo.recargo > 0 ? ` + recargo ${this.moneda(calculo.recargo)}` : '') +
        (calculo.entrega > 0 ? ` − entrega ${this.moneda(calculo.entrega)}` : '') +
        ` → ${calculo.cuotas.length} cuota(s) por ${this.moneda(calculo.financiado)} (${calculo.interes}%) · cajero ${nombreCajero(datos.cajero)}`;
    });

    this.auditoria.registrar({ accion: 'modificar', entidad: 'Creditos', entidadId: creditoId, descripcion });
    return { venta: { ...venta, id: ventaRef.id }, creditoNuevoId: ventaRef.id };
  }

  // =====================================================
  // CRÉDITOS CARGADOS A MANO (dados antes del sistema)
  // =====================================================

  private usuarioOError(): UsuarioRegistro {
    const usuario = this.auditoria.getUsuarioActual();
    if (!usuario) throw new CreditoError('No se pudo identificar al usuario. Volvé a iniciar sesión.');
    return usuario;
  }

  private nombreUsuario(u: UsuarioRegistro): string {
    return (u as any).nombre || (u as any).usuario || '';
  }

  /**
   * Da de alta un crédito que ya estaba otorgado. No genera venta ni ticket, no toca la caja ni el stock.
   * @param clienteId el cliente del sistema, si se eligió uno ('' si se cargó solo con nombre y teléfono)
   */
  async crearManual(d: DatosCreditoManual, clienteId: string, sucursalId: string | null): Promise<string> {
    const usuario = this.usuarioOError();
    const v = validarCreditoManual(d);
    if (!v.cuotas) throw new CreditoError(v.error || 'Revisá los datos.');
    const cuotas = v.cuotas;
    const importe = saldoCuotas(cuotas);
    const ref = doc(collection(this.firestore, 'Creditos'));
    const dni = String(d.dni ?? '').replace(/\D/g, '');
    const credito: Omit<Credito, 'id'> = {
      ventaId: ref.id,
      nroTicket: null,
      fecha: mediodia(d.fechaEntrega),
      sucursalId: sucursalId || null,
      cliente: {
        id: clienteId || '',
        nombre: texto(d.nombre, 120),
        dni: dni ? Number(dni) : null,
        telefono: texto(d.telefono, 120),
        direccion: texto(d.direccion, 200)
      },
      detalle: texto(d.detalle, 500),
      equipos: [{ nombre: texto(d.equipo, 120), imei: texto(d.imei, 40) }],
      precioContado: 0,
      precioFinanciado: importe,
      recargo: 0,
      canje: null,
      entrega: r2(Number(d.entrega) || 0),
      importe,
      saldo: importe,
      pagado: 0,
      cantidadCuotas: cuotas.length,
      cuotas,
      estado: 'vigente',
      ultimoPago: null,
      origen: 'manual',
      cargado: { fecha: new Date().toISOString(), usuario: this.nombreUsuario(usuario) },
      cartasDocumento: [],
      bloqueo: null
    };
    await setDoc(ref, credito);
    this.auditoria.registrar({
      accion: 'crear',
      entidad: 'Creditos',
      entidadId: ref.id,
      descripcion: `Cargó a mano un crédito de la casa ya otorgado: ${credito.cliente.nombre}, ${credito.equipos[0].nombre}, ` +
        `${cuotas.length} cuota(s) por ${this.moneda(importe)} (entrega del ${fechaCorta(d.fechaEntrega)})`
    });
    return ref.id;
  }

  /**
   * Pago viejo de un crédito cargado a mano (los de la planilla). Se aplica a las cuotas, la más vieja primero.
   * No tiene ticket ni entra a la caja: esa plata ya se rindió.
   */
  async registrarPagoAnterior(creditoId: string, p: { fecha: string; importe: any; recargo?: any; nota?: string }): Promise<{ aplicaciones: AplicacionCuota[]; saldo: number }> {
    const usuario = this.usuarioOError();
    const capital = r2(p.importe);
    const mora = r2(p.recargo || 0);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(p.fecha || ''))) throw new CreditoError('Ingresá la fecha del pago.');
    if (p.fecha > hoyLocal()) throw new CreditoError('La fecha del pago no puede ser posterior a hoy.');
    if (!(capital > 0)) throw new CreditoError('El importe tiene que ser mayor a 0.');
    if (mora < 0) throw new CreditoError('El recargo no puede ser negativo.');

    const creditoRef = this.refCredito(creditoId);
    const pagoRef = doc(collection(this.firestore, 'Creditos', creditoId, 'Pagos'));
    let aplicaciones: AplicacionCuota[] = [];
    let saldo = 0;
    let nombre = '';
    await runTransaction(this.firestore, async (tx) => {
      const snap = await tx.get(creditoRef);
      const credito: any = snap.exists() ? snap.data() : null;
      if (!credito) throw new CreditoError('El crédito ya no existe.');
      if (credito.origen !== 'manual') throw new CreditoError('Los pagos anteriores se cargan solo en los créditos cargados a mano.');
      if (credito.estado === 'anulado') throw new CreditoError('Este crédito está anulado.');
      if (credito.estado === 'refinanciado') throw new CreditoError('Este crédito se refinanció: ya no se le cargan pagos.');
      if (p.fecha < String(credito.fecha).slice(0, 10)) throw new CreditoError('La fecha del pago no puede ser anterior a la entrega del equipo.');
      const saldoActual = saldoCuotas(credito.cuotas || []);
      if (saldoActual <= 0.004) throw new CreditoError('Este crédito ya está pagado completo.');
      if (capital > saldoActual + 0.009) throw new CreditoError(`El importe supera lo que falta pagar (${this.moneda(saldoActual)}).`);
      const imp = imputarCuotas(credito.cuotas || [], capital);
      aplicaciones = imp.aplicaciones;
      saldo = saldoCuotas(imp.cuotas);
      nombre = credito.cliente?.nombre || '';
      const fecha = mediodia(p.fecha);
      tx.set(pagoRef, {
        ventaId: null,
        nroTicket: null,
        fecha,
        importe: capital,
        recargo: mora,
        cobrado: r2(capital + mora),
        pagos: [],
        aplicaciones,
        saldoAnterior: saldoActual,
        saldoPosterior: saldo,
        anulado: false,
        anterior: true,
        nota: texto(p.nota, 200),
        usuario,
        registrado: new Date().toISOString()
      });
      const ultimo = !credito.ultimoPago || String(credito.ultimoPago) < fecha ? fecha : credito.ultimoPago;
      tx.update(creditoRef, {
        cuotas: imp.cuotas,
        saldo,
        pagado: r2((Number(credito.importe) || 0) - saldo),
        estado: saldo > 0.004 ? 'vigente' : 'cancelado',
        ultimoPago: ultimo
      });
    });
    this.auditoria.registrar({
      accion: 'modificar',
      entidad: 'Creditos',
      entidadId: creditoId,
      descripcion: `Cargó un pago anterior del crédito de ${nombre}: ${this.moneda(capital)} del ${fechaCorta(p.fecha)}` +
        ` (cuota(s) ${aplicaciones.map(a => a.numero).join(', ')})` + (mora > 0 ? ` + ${this.moneda(mora)} de recargo` : '') +
        ` · saldo ${this.moneda(saldo)}`
    });
    return { aplicaciones, saldo };
  }

  /** Anula un pago anterior mal cargado: sus cuotas vuelven a quedar pendientes */
  async anularPagoAnterior(creditoId: string, pagoId: string, motivo: string): Promise<void> {
    const usuario = this.usuarioOError();
    const creditoRef = this.refCredito(creditoId);
    const pagoRef = doc(this.firestore, 'Creditos', creditoId, 'Pagos', pagoId);
    let descripcion = '';
    await runTransaction(this.firestore, async (tx) => {
      const cSnap = await tx.get(creditoRef);
      const pSnap = await tx.get(pagoRef);
      const credito: any = cSnap.exists() ? cSnap.data() : null;
      const pago: any = pSnap.exists() ? pSnap.data() : null;
      if (!credito || !pago) throw new CreditoError('No se encontró el pago.');
      if (!pago.anterior) throw new CreditoError('Este pago se cobró en Despacho: se anula desde Tickets.');
      if (pago.anulado) throw new CreditoError('Este pago ya estaba anulado.');
      if (credito.estado === 'anulado') throw new CreditoError('Este crédito está anulado.');
      if (credito.estado === 'refinanciado') throw new CreditoError('Este crédito se refinanció: primero anulá la refinanciación (desde Tickets).');
      const cuotas = revertirCuotas(credito.cuotas || [], pago.aplicaciones || []);
      const saldo = saldoCuotas(cuotas);
      tx.update(pagoRef, { anulado: true, motivoAnulacion: texto(motivo, 200), anuladoPor: usuario, anuladoEn: serverTimestamp() });
      tx.update(creditoRef, {
        cuotas,
        saldo,
        pagado: r2((Number(credito.importe) || 0) - saldo),
        estado: saldo > 0.004 ? 'vigente' : 'cancelado'
      });
      descripcion = `Anuló un pago anterior del crédito de ${credito.cliente?.nombre || ''}: ${this.moneda(pago.importe)} ` +
        `del ${fechaCorta(String(pago.fecha).slice(0, 10))}. Motivo: ${texto(motivo, 200)}`;
    });
    this.auditoria.registrar({ accion: 'anular', entidad: 'Creditos', entidadId: creditoId, descripcion });
  }

  /**
   * ✏️ Corrige un crédito cargado a mano (solo superadministradores): cliente, equipo, fechas, cuotas e importe.
   * Los pagos que ya tiene (anteriores o cobrados en Despacho) se vuelven a aplicar sobre las cuotas nuevas.
   */
  async editarManual(creditoId: string, d: DatosCreditoManual, clienteId: string, sucursalId: string | null): Promise<{ cuotasPagadas: number; saldo: number }> {
    const usuario = this.usuarioOError();
    const v = validarCreditoManual(d);
    if (!v.cuotas) throw new CreditoError(v.error || 'Revisá los datos.');
    const creditoRef = this.refCredito(creditoId);
    // Los pagos se buscan antes (en la transacción se vuelven a leer uno por uno)
    const lista = await this.pagosDe(creditoId);
    const pagoRefs = lista.map(p => doc(this.firestore, 'Creditos', creditoId, 'Pagos', p.id));
    let resumen = { cuotasPagadas: 0, saldo: 0 };
    let descripcion = '';

    await runTransaction(this.firestore, async (tx) => {
      const snap = await tx.get(creditoRef);
      const pagosSnap = [];
      for (const ref of pagoRefs) pagosSnap.push(await tx.get(ref));
      const credito: any = snap.exists() ? snap.data() : null;
      if (!credito) throw new CreditoError('El crédito ya no existe.');
      if (credito.origen !== 'manual') throw new CreditoError('Solo se editan los créditos cargados a mano.');
      if (credito.estado === 'anulado') throw new CreditoError('Este crédito está anulado.');
      if (credito.estado === 'refinanciado') throw new CreditoError('Este crédito se refinanció: ya no se puede editar.');

      const pagos = pagosSnap.filter(x => x.exists()).map(x => ({ id: x.id, ...(x.data() as any) }));
      const vigentes = pagos.filter(p => !p.anulado);
      const primerPago = vigentes.map(p => String(p.fecha).slice(0, 10)).sort()[0];
      if (primerPago && d.fechaEntrega > primerPago) {
        throw new CreditoError(`Tiene un pago del ${fechaCorta(primerPago)}: la entrega no puede ser posterior.`);
      }
      const r = reimputarPagos(v.cuotas!, vigentes);
      if (r.error) throw new CreditoError(r.error);
      const importe = saldoCuotas(v.cuotas!);
      const saldo = saldoCuotas(r.cuotas);
      const dni = String(d.dni ?? '').replace(/\D/g, '');
      const antes = {
        nombre: credito.cliente?.nombre || '', equipo: (credito.equipos || [])[0]?.nombre || '',
        fecha: credito.fecha, cantidadCuotas: credito.cantidadCuotas, importe: credito.importe,
        importeCuota: credito.cuotas?.[0]?.importe ?? null, primerMes: String(credito.cuotas?.[0]?.desde || '').slice(0, 7)
      };
      const ultimo = vigentes.map(p => String(p.fecha)).sort().pop() || null;
      tx.update(creditoRef, {
        fecha: mediodia(d.fechaEntrega),
        sucursalId: sucursalId || null,
        cliente: {
          id: clienteId || '',
          nombre: texto(d.nombre, 120),
          dni: dni ? Number(dni) : null,
          telefono: texto(d.telefono, 120),
          direccion: texto(d.direccion, 200)
        },
        detalle: texto(d.detalle, 500),
        equipos: [{ nombre: texto(d.equipo, 120), imei: texto(d.imei, 40) }],
        entrega: r2(Number(d.entrega) || 0),
        precioFinanciado: importe,
        importe,
        saldo,
        pagado: r2(importe - saldo),
        cantidadCuotas: r.cuotas.length,
        cuotas: r.cuotas,
        estado: saldo > 0.004 ? 'vigente' : 'cancelado',
        ultimoPago: ultimo,
        editado: { fecha: new Date().toISOString(), usuario: this.nombreUsuario(usuario), antes }
      });
      // A qué cuotas fue cada pago (para que una anulación posterior revierta lo correcto)
      let saldoCorrido = importe;
      for (const p of [...vigentes].sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)) || String(a.registrado || '').localeCompare(String(b.registrado || '')))) {
        const nuevoSaldo = r2(saldoCorrido - (Number(p.importe) || 0));
        tx.update(doc(this.firestore, 'Creditos', creditoId, 'Pagos', p.id), {
          aplicaciones: r.aplicaciones[p.id] || [],
          saldoAnterior: saldoCorrido,
          saldoPosterior: nuevoSaldo
        });
        saldoCorrido = nuevoSaldo;
      }
      resumen = { cuotasPagadas: r.cuotas.filter(q => q.importe - q.pagado <= 0.004).length, saldo };
      descripcion = `Editó el crédito cargado a mano de ${texto(d.nombre, 120)}: ` +
        `${antes.cantidadCuotas} cuota(s) por ${this.moneda(antes.importe)} → ${r.cuotas.length} cuota(s) por ${this.moneda(importe)}` +
        (vigentes.length ? ` (se volvieron a aplicar ${vigentes.length} pago(s): saldo ${this.moneda(saldo)})` : '');
    });
    this.auditoria.registrar({ accion: 'modificar', entidad: 'Creditos', entidadId: creditoId, descripcion });
    return resumen;
  }

  /** Anula un crédito cargado a mano por error (si no tiene cobros hechos en Despacho) */
  async anularManual(creditoId: string, motivo: string): Promise<void> {
    const usuario = this.usuarioOError();
    const creditoRef = this.refCredito(creditoId);
    const pagos = await this.pagosDe(creditoId);
    if (pagos.some(p => !p.anulado && !p.anterior)) {
      throw new CreditoError('Tiene cuotas cobradas en Despacho: primero hay que anular esos cobros desde Tickets.');
    }
    let nombre = '';
    await runTransaction(this.firestore, async (tx) => {
      const snap = await tx.get(creditoRef);
      const credito: any = snap.exists() ? snap.data() : null;
      if (!credito) throw new CreditoError('El crédito ya no existe.');
      if (credito.origen !== 'manual') throw new CreditoError('Este crédito viene de una venta: se anula con su ticket.');
      if (credito.estado === 'anulado') throw new CreditoError('Este crédito ya estaba anulado.');
      if (credito.estado === 'refinanciado') throw new CreditoError('Este crédito se refinanció: primero anulá la refinanciación (desde Tickets).');
      nombre = credito.cliente?.nombre || '';
      tx.update(creditoRef, {
        estado: 'anulado',
        bloqueo: null,
        anulado: { fecha: new Date().toISOString(), usuario, motivo: texto(motivo, 200) }
      });
    });
    this.auditoria.registrar({
      accion: 'anular', entidad: 'Creditos', entidadId: creditoId,
      descripcion: `Anuló el crédito cargado a mano de ${nombre}. Motivo: ${texto(motivo, 200)}`
    });
  }

  // =====================================================
  // CARTA DOCUMENTO Y BLOQUEO
  // =====================================================

  /** Registra la carta documento y bloquea el crédito (en el mismo paso). Las cuotas se pueden seguir cobrando. */
  async registrarCartaDocumento(creditoId: string, c: { fecha: string; observacion?: string }): Promise<void> {
    const usuario = this.usuarioOError();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(c.fecha || ''))) throw new CreditoError('Ingresá la fecha de la carta documento.');
    if (c.fecha > hoyLocal()) throw new CreditoError('La fecha de la carta no puede ser posterior a hoy.');
    const creditoRef = this.refCredito(creditoId);
    const ahora = new Date().toISOString();
    const quien = this.nombreUsuario(usuario);
    let nombre = '';
    await runTransaction(this.firestore, async (tx) => {
      const snap = await tx.get(creditoRef);
      const credito: any = snap.exists() ? snap.data() : null;
      if (!credito) throw new CreditoError('El crédito ya no existe.');
      if (credito.estado !== 'vigente') throw new CreditoError('Solo se registra en créditos que todavía deben.');
      const cartas: CartaDocumento[] = Array.isArray(credito.cartasDocumento) ? credito.cartasDocumento : [];
      if (cartas.length >= 50) throw new CreditoError('Este crédito ya tiene demasiadas cartas registradas.');
      nombre = credito.cliente?.nombre || '';
      const carta: CartaDocumento = { fecha: c.fecha, observacion: texto(c.observacion, 300), registrada: ahora, usuario: quien };
      tx.update(creditoRef, {
        cartasDocumento: [...cartas, carta],
        bloqueo: credito.bloqueo || { desde: ahora, motivo: `Carta documento del ${fechaCorta(c.fecha)}`, usuario: quien }
      });
    });
    this.auditoria.registrar({
      accion: 'modificar', entidad: 'Creditos', entidadId: creditoId,
      descripcion: `Registró carta documento del ${fechaCorta(c.fecha)} y bloqueó el crédito de ${nombre}` +
        (texto(c.observacion) ? `: ${texto(c.observacion)}` : '')
    });
  }

  async desbloquear(creditoId: string, motivo: string): Promise<void> {
    const usuario = this.usuarioOError();
    const creditoRef = this.refCredito(creditoId);
    let nombre = '';
    await runTransaction(this.firestore, async (tx) => {
      const snap = await tx.get(creditoRef);
      const credito: any = snap.exists() ? snap.data() : null;
      if (!credito) throw new CreditoError('El crédito ya no existe.');
      if (!credito.bloqueo) throw new CreditoError('El crédito no está bloqueado.');
      nombre = credito.cliente?.nombre || '';
      tx.update(creditoRef, {
        bloqueo: null,
        ultimoDesbloqueo: { desde: new Date().toISOString(), motivo: texto(motivo, 200), usuario: this.nombreUsuario(usuario) }
      });
    });
    this.auditoria.registrar({
      accion: 'modificar', entidad: 'Creditos', entidadId: creditoId,
      descripcion: `Desbloqueó el crédito de ${nombre}. Motivo: ${texto(motivo, 200)}`
    });
  }

  // =====================================================
  // ANULACIÓN DEL TICKET DE UN COBRO (la llama TicketsService.anular dentro de su transacción)
  // =====================================================

  /** Fase de LECTURAS. null si el ticket no es un cobro de cuotas o ya no hay nada que revertir. */
  async leerAnulacion(tx: Transaction, venta: any): Promise<LecturaAnulacionCuota | null> {
    if (venta?.tipoVenta !== 'cobrocuota' || !venta.cuotaCredito?.creditoId) return null;
    const creditoRef = this.refCredito(venta.cuotaCredito.creditoId);
    const pagoRef = doc(this.firestore, 'Creditos', venta.cuotaCredito.creditoId, 'Pagos', venta.id);
    const creditoSnap = await tx.get(creditoRef);
    const pagoSnap = await tx.get(pagoRef);
    const credito: any = creditoSnap.exists() ? creditoSnap.data() : null;
    const pago: any = pagoSnap.exists() ? pagoSnap.data() : null;
    if (!credito || !pago || pago.anulado) return null;
    if (credito.estado === 'anulado') throw new CreditoError('El crédito de este cobro está anulado.');
    if (credito.estado === 'refinanciado') {
      throw new CreditoError('El crédito de este cobro se refinanció después: primero anulá la refinanciación.');
    }
    return { creditoRef, credito, pagoRef, pago };
  }

  /** Fase de ESCRITURAS: las cuotas vuelven a quedar pendientes */
  escribirAnulacion(tx: Transaction, l: LecturaAnulacionCuota, motivo: string, usuario: UsuarioRegistro): void {
    const cuotas = revertirCuotas(l.credito.cuotas || [], l.pago.aplicaciones || []);
    const saldo = saldoCuotas(cuotas);
    tx.update(l.pagoRef, { anulado: true, motivoAnulacion: motivo, anuladoPor: usuario, anuladoEn: serverTimestamp() });
    tx.update(l.creditoRef, {
      cuotas,
      saldo,
      pagado: r2((Number(l.credito.importe) || 0) - saldo),
      estado: saldo > 0.004 ? 'vigente' : 'cancelado'
    });
  }

  private moneda(n: number): string {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(Number(n) || 0);
  }
}
