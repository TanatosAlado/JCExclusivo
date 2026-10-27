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
import { AuditoriaService, UsuarioRegistro } from 'src/app/shared/services/auditoria.service';

/** Tipos de movimiento de efectivo de una caja */
export type TipoMovimientoCaja = 'ingreso' | 'retiro' | 'gasto' | 'proveedor' | 'deposito';

export const TIPOS_MOVIMIENTO: { valor: TipoMovimientoCaja; nombre: string; signo: 1 | -1; ayuda: string }[] = [
  { valor: 'ingreso',   nombre: 'Ingreso de efectivo', signo: 1,  ayuda: 'Entra plata a la caja que no es una venta (ej: cambio, aporte).' },
  { valor: 'retiro',    nombre: 'Retiro de efectivo',  signo: -1, ayuda: 'Se saca plata de la caja (ej: retiro del dueño).' },
  { valor: 'gasto',     nombre: 'Gasto',               signo: -1, ayuda: 'Gasto pagado con plata de la caja (ej: limpieza, delivery).' },
  { valor: 'proveedor', nombre: 'Pago a proveedor',    signo: -1, ayuda: 'Pago a un proveedor con plata de la caja.' },
  { valor: 'deposito',  nombre: 'Depósito bancario',   signo: -1, ayuda: 'Se lleva plata de la caja al banco.' }
];

export function nombreTipoMovimiento(tipo: string): string {
  return TIPOS_MOVIMIENTO.find(t => t.valor === tipo)?.nombre || tipo;
}

export function signoMovimiento(tipo: string): number {
  return TIPOS_MOVIMIENTO.find(t => t.valor === tipo)?.signo ?? 0;
}

export interface MovimientoCaja {
  id?: string;
  cajaId: string;
  sucursalId: string;
  tipo: TipoMovimientoCaja;
  importe: number;               // siempre positivo; el signo lo da el tipo
  motivo: string;
  proveedor?: string;
  observaciones?: string;
  fecha: string;                 // ISO (hora de la PC)
  creadoEn?: any;                // hora del servidor
  usuario: UsuarioRegistro;
  anulado?: boolean;
  motivoAnulacion?: string;
  anuladoPor?: UsuarioRegistro | null;
  anuladoEn?: any;
  corrigeA?: string | null;      // id del movimiento anulado que este corrige
  corregidoPor?: string | null;  // id del movimiento que corrige a este
}

/** Error de negocio con mensaje para mostrar */
export class MovimientoCajaError extends Error {
  constructor(message: string) {
    super(message);
  }
}

/**
 * Movimientos de efectivo de la caja (ingresos, retiros, gastos, proveedores, depósitos).
 *
 * - Nunca se modifican ni se borran: un movimiento mal cargado se ANULA (con motivo)
 *   y, si hace falta, se carga el correcto vinculado al anulado (corrección).
 * - Solo se pueden registrar o anular con la caja ABIERTA.
 * - Cada operación actualiza el contador 'cantidadMovimientos' de la caja, que el
 *   cierre usa para detectar movimientos cargados mientras se contaba la plata.
 */
@Injectable({ providedIn: 'root' })
export class MovimientosCajaService {

  constructor(private firestore: Firestore, private auditoria: AuditoriaService) { }

  async registrar(
    caja: any,
    datos: { tipo: TipoMovimientoCaja; importe: number; motivo: string; proveedor?: string; observaciones?: string },
    corrigeA?: MovimientoCaja | null
  ): Promise<MovimientoCaja> {

    const usuario = this.auditoria.getUsuarioActual();
    if (!usuario) {
      throw new MovimientoCajaError('No se pudo identificar al usuario. Volvé a iniciar sesión.');
    }

    const importe = Math.round((Number(datos.importe) || 0) * 100) / 100;
    if (!(importe > 0)) {
      throw new MovimientoCajaError('El importe tiene que ser mayor a 0.');
    }
    if (!datos.motivo || datos.motivo.trim().length < 3) {
      throw new MovimientoCajaError('Ingresá el motivo del movimiento.');
    }
    if (datos.tipo === 'proveedor' && !(datos.proveedor || '').trim()) {
      throw new MovimientoCajaError('Ingresá el nombre del proveedor.');
    }

    const movimiento: MovimientoCaja = {
      cajaId: caja.id,
      sucursalId: caja.sucursalId,
      tipo: datos.tipo,
      importe,
      motivo: datos.motivo.trim(),
      proveedor: datos.tipo === 'proveedor' ? (datos.proveedor || '').trim() : '',
      observaciones: (datos.observaciones || '').trim(),
      fecha: new Date().toISOString(),
      usuario,
      anulado: false,
      corrigeA: corrigeA?.id || null
    };

    const movRef = doc(collection(this.firestore, 'MovimientosCaja'));
    const cajaRef = doc(this.firestore, 'Cajas', caja.id);

    const registro = await this.auditoria.armarRegistro({
      accion: 'crear',
      entidad: 'MovimientosCaja',
      entidadId: movRef.id,
      descripcion: `${nombreTipoMovimiento(datos.tipo)} de $${importe.toFixed(2)}: ${movimiento.motivo}` +
        (movimiento.proveedor ? ` (proveedor: ${movimiento.proveedor})` : '') +
        (corrigeA ? ` — corrige el movimiento ${corrigeA.id}` : ''),
      extra: { cajaId: caja.id, sucursalId: caja.sucursalId, tipo: datos.tipo, importe }
    });

    await runTransaction(this.firestore, async (tx) => {
      const cajaSnap = await tx.get(cajaRef);
      const datosCaja: any = cajaSnap.exists() ? cajaSnap.data() : null;
      if (!datosCaja || datosCaja.abierta === false) {
        throw new MovimientoCajaError('La caja está cerrada. No se pueden registrar movimientos.');
      }

      tx.set(movRef, { ...JSON.parse(JSON.stringify(movimiento)), creadoEn: serverTimestamp() });
      tx.update(cajaRef, { cantidadMovimientos: (Number(datosCaja.cantidadMovimientos) || 0) + 1 });

      if (corrigeA?.id) {
        tx.update(doc(this.firestore, 'MovimientosCaja', corrigeA.id), { corregidoPor: movRef.id });
      }

      this.auditoria.registrarEnTransaccion(tx, registro);
    });

    return { ...movimiento, id: movRef.id };
  }

  /** Anula un movimiento (no se borra: queda con motivo, usuario y fecha) */
  async anular(caja: any, mov: MovimientoCaja, motivo: string): Promise<void> {
    const usuario = this.auditoria.getUsuarioActual();
    if (!usuario) {
      throw new MovimientoCajaError('No se pudo identificar al usuario. Volvé a iniciar sesión.');
    }
    if (!mov.id) return;
    if (!motivo || motivo.trim().length < 3) {
      throw new MovimientoCajaError('Ingresá el motivo de la anulación.');
    }

    const movRef = doc(this.firestore, 'MovimientosCaja', mov.id);
    const cajaRef = doc(this.firestore, 'Cajas', caja.id);

    const registro = await this.auditoria.armarRegistro({
      accion: 'anular',
      entidad: 'MovimientosCaja',
      entidadId: mov.id,
      descripcion: `Anuló ${nombreTipoMovimiento(mov.tipo).toLowerCase()} de $${Number(mov.importe).toFixed(2)} (${mov.motivo}). Motivo: ${motivo.trim()}`,
      extra: { cajaId: caja.id, tipo: mov.tipo, importe: mov.importe }
    });

    await runTransaction(this.firestore, async (tx) => {
      const cajaSnap = await tx.get(cajaRef);
      const movSnap = await tx.get(movRef);
      const datosCaja: any = cajaSnap.exists() ? cajaSnap.data() : null;

      if (!datosCaja || datosCaja.abierta === false) {
        throw new MovimientoCajaError('La caja está cerrada. No se pueden anular movimientos.');
      }
      if (!movSnap.exists()) {
        throw new MovimientoCajaError('El movimiento no existe.');
      }
      if ((movSnap.data() as any).anulado === true) {
        throw new MovimientoCajaError('Ese movimiento ya estaba anulado.');
      }

      tx.update(movRef, {
        anulado: true,
        motivoAnulacion: motivo.trim(),
        anuladoPor: usuario,
        anuladoEn: serverTimestamp()
      });
      tx.update(cajaRef, { cantidadMovimientos: (Number(datosCaja.cantidadMovimientos) || 0) + 1 });

      this.auditoria.registrarEnTransaccion(tx, registro);
    });
  }

  /** Movimientos de una caja (más nuevos primero) */
  async listarPorCaja(cajaId: string): Promise<MovimientoCaja[]> {
    const snap = await getDocs(query(collection(this.firestore, 'MovimientosCaja'), where('cajaId', '==', cajaId)));
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() } as MovimientoCaja))
      .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  }

  /** Movimientos entre dos fechas (para el libro diario del admin) */
  async listarEntre(inicio: Date, fin: Date): Promise<MovimientoCaja[]> {
    const snap = await getDocs(query(
      collection(this.firestore, 'MovimientosCaja'),
      where('fecha', '>=', inicio.toISOString()),
      where('fecha', '<=', fin.toISOString())
    ));
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as MovimientoCaja));
  }

  /** Comprobante para imprimir (80 mm) con espacio para firma — útil en retiros y pagos */
  imprimirComprobante(mov: MovimientoCaja, nombreSucursal: string): void {
    const win = window.open('', '_blank', 'width=420,height=600');
    if (!win) {
      alert('El navegador bloqueó la ventana. Permití las ventanas emergentes para este sitio.');
      return;
    }
    const esc = (t: any) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const importe = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(Number(mov.importe) || 0);
    const fecha = new Date(mov.fecha).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });

    win.document.write(`
<html><head><meta charset="utf-8"><title>Comprobante de caja</title>
<style>
  @page { size: 80mm auto; margin: 0; }
  * { color: #000; }
  body { width: 80mm; padding: 6px; font-family: monospace; font-size: 12px; }
  h1, h2 { text-align: center; margin: 4px 0; }
  h1 { font-size: 15px; } h2 { font-size: 13px; }
  .importe { text-align: center; font-size: 20px; font-weight: bold; margin: 12px 0; }
  p { margin: 4px 0; }
  .firma { margin-top: 50px; border-top: 1px solid #000; text-align: center; padding-top: 3px; }
  .anulado { text-align: center; font-weight: bold; border: 2px solid #000; padding: 4px; margin: 8px 0; }
</style></head>
<body>
  <h1>COMPROBANTE DE CAJA</h1>
  <h2>${esc(nombreSucursal)}</h2>
  ${mov.anulado ? '<div class="anulado">ANULADO</div>' : ''}
  <p><strong>${esc(nombreTipoMovimiento(mov.tipo))}</strong></p>
  <div class="importe">${importe}</div>
  <p><strong>Motivo:</strong> ${esc(mov.motivo)}</p>
  ${mov.proveedor ? `<p><strong>Proveedor:</strong> ${esc(mov.proveedor)}</p>` : ''}
  ${mov.observaciones ? `<p><strong>Obs.:</strong> ${esc(mov.observaciones)}</p>` : ''}
  <p><strong>Fecha:</strong> ${fecha}</p>
  <p><strong>Registró:</strong> ${esc(mov.usuario?.nombre || mov.usuario?.usuario)}</p>
  <div class="firma">Firma de quien recibe / entrega</div>
  <p style="text-align:center;font-size:10px;margin-top:10px">Mov. ${esc(mov.id)}</p>
  <script>window.onload = function () { window.print(); };</script>
</body></html>`);
    win.document.close();
  }
}
