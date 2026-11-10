import { Injectable } from '@angular/core';
import {
  Firestore, collection, doc, getDocs, query, runTransaction, serverTimestamp, where
} from '@angular/fire/firestore';
import { AuditoriaService } from 'src/app/shared/services/auditoria.service';
import {
  clienteDeOrden, idCuenta, imputarFIFO, MAX_NOTA, MetodoPagoInterno, SucursalRef, sucursalesDeudoras,
  sucursalTaller, TrabajoTerminado, validarCosto, validarPago
} from './cuenta-taller';

export class CuentaTallerError extends Error {
  constructor(message: string) {
    super(message);
  }
}

/** Colecciones donde puede estar una orden */
const COLECCIONES_ORDEN = ['Ordenes Pendientes', 'Ordenes Finalizadas', 'Ordenes Eliminadas'];

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const moneda = (n: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(Number(n) || 0);

/**
 * Cuenta entre el local y el taller.
 *
 * Firestore:
 *   CuentasInternas/{deudor}__{taller}                → saldo (lo que el local le debe al taller)
 *   CuentasInternas/{id}/Movimientos/orden_{ordenId}  → cargo de una orden terminada (pendiente = lo que falta pagar)
 *   CuentasInternas/{id}/Movimientos/{auto}           → pago (efectivo o transferencia), con a qué órdenes se aplicó
 *   Pago en efectivo: además un movimiento en cada caja (sale del local, entra al taller), marcados "interno".
 */
@Injectable({ providedIn: 'root' })
export class CuentaTallerService {

  constructor(private firestore: Firestore, private auditoria: AuditoriaService) { }

  private usuario() {
    const u = this.auditoria.getUsuarioActual();
    if (!u) throw new CuentaTallerError('No se pudo identificar al usuario. Volvé a iniciar sesión.');
    return u;
  }

  private refCuenta(id: string) {
    return doc(this.firestore, 'CuentasInternas', id);
  }

  private refMovimiento(cuentaId: string, movId: string) {
    return doc(this.firestore, 'CuentasInternas', cuentaId, 'Movimientos', movId);
  }

  // =====================================================
  // CONFIGURACIÓN (qué sucursal es el taller)
  // =====================================================

  async configuracion(): Promise<{ taller: SucursalRef | null; deudoras: SucursalRef[] }> {
    const snap = await getDocs(collection(this.firestore, 'Sucursales'));
    const sucursales = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
    const taller = sucursalTaller(sucursales);
    return { taller, deudoras: sucursalesDeudoras(sucursales, taller?.id || null) };
  }

  // =====================================================
  // TRABAJO TERMINADO (nace la deuda)
  // =====================================================

  /**
   * El taller termina el trabajo: la orden queda "Finalizado" (lista para retirar)
   * y, si el costo es mayor a 0, el local le queda debiendo ese importe al taller.
   */
  async terminarTrabajo(
    orden: any,
    datos: { costo: any; deudor: SucursalRef; taller: SucursalRef; nota?: string }
  ): Promise<TrabajoTerminado> {
    const usuario = this.usuario();
    const costo = (() => { try { return validarCosto(datos.costo); } catch (e: any) { throw new CuentaTallerError(e.message); } })();
    if (!datos.taller?.id) throw new CuentaTallerError('Falta definir cuál es la sucursal del taller (Gestiones → Sucursales).');
    if (!datos.deudor?.id) throw new CuentaTallerError('Elegí qué sucursal le paga al taller.');
    if (datos.deudor.id === datos.taller.id) throw new CuentaTallerError('La sucursal que paga no puede ser el taller.');

    const ordenRef = doc(this.firestore, 'Ordenes Pendientes', orden.id);
    const cuentaId = idCuenta(datos.deudor.id, datos.taller.id);
    const cuentaRef = this.refCuenta(cuentaId);
    const cargoId = `orden_${orden.id}`;
    const cargoRef = this.refMovimiento(cuentaId, cargoId);
    const ahora = new Date().toISOString();
    const nota = String(datos.nota || '').trim().slice(0, MAX_NOTA);

    const trabajo: TrabajoTerminado = {
      fecha: ahora,
      usuario,
      costoTaller: costo,
      deudor: { id: datos.deudor.id, nombre: datos.deudor.nombre },
      taller: { id: datos.taller.id, nombre: datos.taller.nombre },
      ...(nota ? { nota } : {}),
      cargoId: costo > 0 ? cargoId : null
    };

    const registro = await this.auditoria.armarRegistro({
      accion: 'modificar',
      entidad: 'Ordenes',
      entidadId: orden.id,
      descripcion: `Taller: trabajo terminado de la orden #${orden.numeroOrden} (${orden.equipo || 'equipo'}). ` +
        (costo > 0 ? `Costo del taller ${moneda(costo)}: ${datos.deudor.nombre} se lo debe a ${datos.taller.nombre}.` : 'Sin costo del taller.'),
      extra: { ordenId: orden.id, costoTaller: costo, deudor: datos.deudor.id, taller: datos.taller.id }
    });

    await runTransaction(this.firestore, async tx => {
      const ordenSnap = await tx.get(ordenRef);
      const cuentaSnap = await tx.get(cuentaRef);
      const cargoSnap = await tx.get(cargoRef);

      if (!ordenSnap.exists()) {
        throw new CuentaTallerError('La orden ya no está en Pendientes (¿la entregaron o la eliminaron?). Actualizá la lista.');
      }
      const datosOrden: any = ordenSnap.data();
      if (datosOrden.trabajoTerminado) {
        throw new CuentaTallerError('Esta orden ya tiene el trabajo terminado.');
      }
      if (costo > 0 && cargoSnap.exists() && (cargoSnap.data() as any).anulado !== true) {
        throw new CuentaTallerError('Esta orden ya tiene un cargo en la cuenta del taller.');
      }

      tx.update(ordenRef, { trabajoTerminado: trabajo, estado: 'Finalizado' });

      if (costo > 0) {
        const saldoAnterior = cuentaSnap.exists() ? Number((cuentaSnap.data() as any).saldo) || 0 : 0;
        tx.set(cargoRef, {
          tipo: 'cargo',
          importe: costo,
          pendiente: costo,
          fecha: ahora,
          ordenId: orden.id,
          numeroOrden: datosOrden.numeroOrden ?? null,
          equipo: datosOrden.equipo || '',
          cliente: clienteDeOrden(datosOrden),
          presupuesto: Number(datosOrden.presupuesto) || 0,
          ...(nota ? { nota } : {}),
          usuario,
          anulado: false,
          creadoEn: serverTimestamp()
        });
        tx.set(cuentaRef, {
          deudor: trabajo.deudor,
          acreedor: trabajo.taller,
          saldo: r2(saldoAnterior + costo),
          actualizado: ahora
        }, { merge: true });
      }

      this.auditoria.registrarEnTransaccion(tx, registro);
    });

    return trabajo;
  }

  // =====================================================
  // LECTURA
  // =====================================================

  async cuentas(): Promise<any[]> {
    const snap = await getDocs(collection(this.firestore, 'CuentasInternas'));
    return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
  }

  async movimientos(cuentaId: string): Promise<any[]> {
    const snap = await getDocs(collection(this.firestore, 'CuentasInternas', cuentaId, 'Movimientos'));
    return snap.docs
      .map(d => ({ id: d.id, ...(d.data() as any) }))
      .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  }

  /** Caja abierta de una sucursal (la más reciente) */
  private async cajaAbierta(sucursalId: string): Promise<any | null> {
    const snap = await getDocs(query(
      collection(this.firestore, 'Cajas'),
      where('sucursalId', '==', sucursalId),
      where('abierta', '==', true)
    ));
    const cajas = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))
      .sort((a, b) => String(b.fechaApertura || '').localeCompare(String(a.fechaApertura || '')));
    return cajas[0] || null;
  }

  // =====================================================
  // PAGOS
  // =====================================================

  /**
   * El local le paga al taller.
   *  - efectivo: sale de la caja abierta del local y entra en la caja abierta del taller (las dos tienen que estar abiertas).
   *  - transferencia: no mueve las cajas.
   * Se aplica a las órdenes más viejas primero.
   */
  async pagar(cuenta: any, datos: { importe: any; metodo: MetodoPagoInterno; nota?: string }): Promise<any> {
    const usuario = this.usuario();
    const metodo: MetodoPagoInterno = datos.metodo === 'efectivo' ? 'efectivo' : 'transferencia';
    const nota = String(datos.nota || '').trim().slice(0, MAX_NOTA);
    const cuentaRef = this.refCuenta(cuenta.id);

    // Cargos con algo pendiente (se vuelven a leer dentro de la transacción)
    const movs = await this.movimientos(cuenta.id);
    const idsCargos = movs.filter(m => m.tipo === 'cargo' && m.anulado !== true && (Number(m.pendiente) || 0) > 0).map(m => m.id);

    let cajaLocal: any = null, cajaTaller: any = null;
    if (metodo === 'efectivo') {
      [cajaLocal, cajaTaller] = await Promise.all([this.cajaAbierta(cuenta.deudor.id), this.cajaAbierta(cuenta.acreedor.id)]);
      if (!cajaLocal) throw new CuentaTallerError(`La caja de ${cuenta.deudor.nombre} no está abierta. Abrila para pagar en efectivo.`);
      if (!cajaTaller) throw new CuentaTallerError(`La caja de ${cuenta.acreedor.nombre} no está abierta. Abrila para recibir el efectivo.`);
    }

    const pagoRef = doc(collection(this.firestore, 'CuentasInternas', cuenta.id, 'Movimientos'));
    const movLocalRef = metodo === 'efectivo' ? doc(collection(this.firestore, 'MovimientosCaja')) : null;
    const movTallerRef = metodo === 'efectivo' ? doc(collection(this.firestore, 'MovimientosCaja')) : null;
    const ahora = new Date().toISOString();
    let pago: any = null;

    const registro = await this.auditoria.armarRegistro({
      accion: 'crear',
      entidad: 'CuentasInternas',
      entidadId: cuenta.id,
      descripcion: `${cuenta.deudor.nombre} le pagó a ${cuenta.acreedor.nombre} (${metodo})`,
      extra: { cuentaId: cuenta.id, metodo }
    });

    await runTransaction(this.firestore, async tx => {
      const cuentaSnap = await tx.get(cuentaRef);
      if (!cuentaSnap.exists()) throw new CuentaTallerError('No hay deuda registrada en esta cuenta.');
      const saldo = Number((cuentaSnap.data() as any).saldo) || 0;
      const importe = (() => { try { return validarPago(datos.importe, saldo); } catch (e: any) { throw new CuentaTallerError(e.message); } })();

      const cargosSnap = await Promise.all(idsCargos.map(id => tx.get(this.refMovimiento(cuenta.id, id))));
      const cargos = cargosSnap
        .filter(s => s.exists())
        .map(s => ({ id: s.id, ...(s.data() as any) }))
        .filter(c => c.anulado !== true && (Number(c.pendiente) || 0) > 0);

      let cajaLocalSnap: any = null, cajaTallerSnap: any = null;
      if (metodo === 'efectivo') {
        cajaLocalSnap = await tx.get(doc(this.firestore, 'Cajas', cajaLocal.id));
        cajaTallerSnap = await tx.get(doc(this.firestore, 'Cajas', cajaTaller.id));
        if (!cajaLocalSnap.exists() || cajaLocalSnap.data().abierta === false) throw new CuentaTallerError(`La caja de ${cuenta.deudor.nombre} se cerró. Abrila de nuevo.`);
        if (!cajaTallerSnap.exists() || cajaTallerSnap.data().abierta === false) throw new CuentaTallerError(`La caja de ${cuenta.acreedor.nombre} se cerró. Abrila de nuevo.`);
      }

      const { aplicaciones } = imputarFIFO(
        cargos.map(c => ({ id: c.id, fecha: c.fecha, pendiente: Number(c.pendiente) || 0, nroTicket: c.numeroOrden ?? null })),
        importe
      );

      // ---------- Escrituras ----------
      for (const a of aplicaciones) {
        tx.update(this.refMovimiento(cuenta.id, a.cargoId), { pendiente: a.pendienteNuevo });
      }
      pago = {
        tipo: 'pago',
        metodo,
        importe,
        fecha: ahora,
        aplicaciones: aplicaciones.map(a => ({ cargoId: a.cargoId, numeroOrden: a.nroTicket, importe: a.importe })),
        movimientosCaja: metodo === 'efectivo'
          ? { local: { cajaId: cajaLocal.id, movId: movLocalRef!.id }, taller: { cajaId: cajaTaller.id, movId: movTallerRef!.id } }
          : null,
        ...(nota ? { nota } : {}),
        usuario,
        anulado: false,
        creadoEn: serverTimestamp()
      };
      tx.set(pagoRef, pago);
      tx.update(cuentaRef, { saldo: r2(saldo - importe), actualizado: ahora });

      if (metodo === 'efectivo') {
        const detalle = aplicaciones.map(a => `#${a.nroTicket}`).join(', ');
        const base = { importe, fecha: ahora, usuario, anulado: false, corrigeA: null, interno: true,
          cuentaInterna: { cuentaId: cuenta.id, pagoId: pagoRef.id }, observaciones: nota || (detalle ? `Órdenes ${detalle}` : '') };
        tx.set(movLocalRef!, {
          ...base, cajaId: cajaLocal.id, sucursalId: cuenta.deudor.id, tipo: 'proveedor',
          motivo: `Pago al ${cuenta.acreedor.nombre} (reparaciones)`, proveedor: cuenta.acreedor.nombre, creadoEn: serverTimestamp()
        });
        tx.set(movTallerRef!, {
          ...base, cajaId: cajaTaller.id, sucursalId: cuenta.acreedor.id, tipo: 'ingreso',
          motivo: `Cobro a ${cuenta.deudor.nombre} (reparaciones)`, proveedor: '', creadoEn: serverTimestamp()
        });
        tx.update(cajaLocalSnap.ref, { cantidadMovimientos: (Number(cajaLocalSnap.data().cantidadMovimientos) || 0) + 1 });
        tx.update(cajaTallerSnap.ref, { cantidadMovimientos: (Number(cajaTallerSnap.data().cantidadMovimientos) || 0) + 1 });
      }

      if (registro) {
        registro.descripcion = `${cuenta.deudor.nombre} le pagó ${moneda(importe)} a ${cuenta.acreedor.nombre} ` +
          `(${metodo === 'efectivo' ? 'efectivo entre cajas' : 'transferencia'})` +
          (aplicaciones.length ? `. Órdenes: ${aplicaciones.map(a => '#' + a.nroTicket).join(', ')}` : '');
      }
      this.auditoria.registrarEnTransaccion(tx, registro);
    });

    return { ...pago, id: pagoRef.id };
  }

  /**
   * Anula un pago: las órdenes vuelven a quedar debiendo lo que ese pago les había cancelado.
   * Si fue en efectivo, se anulan los dos movimientos de caja (las dos cajas tienen que seguir abiertas).
   */
  async anularPago(cuenta: any, pago: any, motivo: string): Promise<void> {
    const usuario = this.usuario();
    const m = String(motivo || '').trim();
    if (m.length < 3) throw new CuentaTallerError('Ingresá el motivo de la anulación.');
    const cuentaRef = this.refCuenta(cuenta.id);
    const pagoRef = this.refMovimiento(cuenta.id, pago.id);
    const ahora = new Date().toISOString();

    const registro = await this.auditoria.armarRegistro({
      accion: 'anular',
      entidad: 'CuentasInternas',
      entidadId: cuenta.id,
      descripcion: `Anuló un pago de ${moneda(pago.importe)} de ${cuenta.deudor.nombre} a ${cuenta.acreedor.nombre}. Motivo: ${m}`,
      extra: { cuentaId: cuenta.id, pagoId: pago.id }
    });

    await runTransaction(this.firestore, async tx => {
      const pagoSnap = await tx.get(pagoRef);
      const cuentaSnap = await tx.get(cuentaRef);
      if (!pagoSnap.exists()) throw new CuentaTallerError('El pago ya no existe.');
      const datosPago: any = pagoSnap.data();
      if (datosPago.anulado) throw new CuentaTallerError('Este pago ya estaba anulado.');
      const aplicaciones: any[] = datosPago.aplicaciones || [];
      const cargosSnap = await Promise.all(aplicaciones.map(a => tx.get(this.refMovimiento(cuenta.id, a.cargoId))));

      let movs: any[] = [];
      if (datosPago.metodo === 'efectivo' && datosPago.movimientosCaja) {
        const mc = datosPago.movimientosCaja;
        const cajasSnap = await Promise.all([mc.local.cajaId, mc.taller.cajaId].map(id => tx.get(doc(this.firestore, 'Cajas', id))));
        if (cajasSnap.some(c => !c.exists() || (c.data() as any).abierta === false)) {
          throw new CuentaTallerError('Una de las cajas de ese pago ya se cerró: no se puede anular. Registrá el ajuste con un movimiento de caja.');
        }
        movs = [
          { ref: doc(this.firestore, 'MovimientosCaja', mc.local.movId), caja: cajasSnap[0] },
          { ref: doc(this.firestore, 'MovimientosCaja', mc.taller.movId), caja: cajasSnap[1] }
        ];
      }

      // ---------- Escrituras ----------
      aplicaciones.forEach((a, i) => {
        const c = cargosSnap[i];
        if (!c.exists()) return;
        const pendiente = Number((c.data() as any).pendiente) || 0;
        tx.update(c.ref, { pendiente: r2(pendiente + (Number(a.importe) || 0)) });
      });
      tx.update(pagoRef, { anulado: true, motivoAnulacion: m, anuladoPor: usuario, anuladoEn: ahora });
      const saldo = cuentaSnap.exists() ? Number((cuentaSnap.data() as any).saldo) || 0 : 0;
      tx.update(cuentaRef, { saldo: r2(saldo + (Number(datosPago.importe) || 0)), actualizado: ahora });
      for (const mv of movs) {
        tx.update(mv.ref, { anulado: true, motivoAnulacion: `Pago interno anulado: ${m}`, anuladoPor: usuario, anuladoEn: serverTimestamp() });
        tx.update(mv.caja.ref, { cantidadMovimientos: (Number((mv.caja.data() as any).cantidadMovimientos) || 0) + 1 });
      }
      this.auditoria.registrarEnTransaccion(tx, registro);
    });
  }

  // =====================================================
  // CORRECCIONES DE UN CARGO (solo si no tiene pagos aplicados)
  // =====================================================

  /** Cambia el costo del taller de una orden (0 = lo anula) */
  async corregirCargo(cuenta: any, cargo: any, nuevoCosto: any, motivo: string): Promise<void> {
    const usuario = this.usuario();
    const costo = (() => { try { return validarCosto(nuevoCosto); } catch (e: any) { throw new CuentaTallerError(e.message); } })();
    const m = String(motivo || '').trim();
    if (m.length < 3) throw new CuentaTallerError('Ingresá el motivo de la corrección.');
    const cuentaRef = this.refCuenta(cuenta.id);
    const cargoRef = this.refMovimiento(cuenta.id, cargo.id);
    const ordenRefs = COLECCIONES_ORDEN.map(c => doc(this.firestore, c, cargo.ordenId));
    const ahora = new Date().toISOString();

    const registro = await this.auditoria.armarRegistro({
      accion: 'modificar',
      entidad: 'CuentasInternas',
      entidadId: cuenta.id,
      descripcion: `Corrigió el costo del taller de la orden #${cargo.numeroOrden}: ${moneda(cargo.importe)} → ${moneda(costo)}` +
        (costo === 0 ? ' (anulado)' : '') + `. Motivo: ${m}`,
      antes: { costoTaller: cargo.importe },
      despues: { costoTaller: costo }
    });

    await runTransaction(this.firestore, async tx => {
      const cargoSnap = await tx.get(cargoRef);
      const cuentaSnap = await tx.get(cuentaRef);
      const ordenesSnap = await Promise.all(ordenRefs.map(r => tx.get(r)));
      if (!cargoSnap.exists()) throw new CuentaTallerError('El cargo ya no existe.');
      const c: any = cargoSnap.data();
      if (c.anulado) throw new CuentaTallerError('Este cargo ya estaba anulado.');
      if (r2(c.pendiente) !== r2(c.importe)) {
        throw new CuentaTallerError('Esta orden ya tiene pagos aplicados. Anulá primero el pago y después corregí el costo.');
      }
      const diferencia = r2(costo - (Number(c.importe) || 0));
      const saldo = cuentaSnap.exists() ? Number((cuentaSnap.data() as any).saldo) || 0 : 0;

      if (costo === 0) {
        tx.update(cargoRef, { anulado: true, pendiente: 0, motivoAnulacion: m, anuladoPor: usuario, anuladoEn: ahora });
      } else {
        tx.update(cargoRef, {
          importe: costo, pendiente: costo,
          correcciones: [...(c.correcciones || []), { fecha: ahora, usuario: usuario.nombre || usuario.usuario, antes: c.importe, despues: costo, motivo: m }]
        });
      }
      tx.update(cuentaRef, { saldo: r2(saldo + diferencia), actualizado: ahora });

      const ordenSnap = ordenesSnap.find(s => s.exists());
      if (ordenSnap) {
        const t: any = (ordenSnap.data() as any).trabajoTerminado || {};
        tx.update(ordenSnap.ref, {
          trabajoTerminado: {
            ...t,
            costoTaller: costo,
            cargoId: costo > 0 ? cargo.id : null,
            corregido: { fecha: ahora, usuario: usuario.nombre || usuario.usuario, antes: Number(c.importe) || 0 }
          }
        });
      }
      this.auditoria.registrarEnTransaccion(tx, registro);
    });
  }
}
