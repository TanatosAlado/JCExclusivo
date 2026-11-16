import { Injectable } from '@angular/core';
import { Firestore, arrayUnion, doc, getDoc, updateDoc } from '@angular/fire/firestore';
import { Storage, getDownloadURL, ref, uploadBytes } from '@angular/fire/storage';
import { AuditoriaService } from './auditoria.service';
import {
  ComprobantePago, PagoTransferencia, errorComprobante, puedeSubirComprobante, rutaComprobante, tipoComprobante
} from '../utils/pago-web';

export class PagoPedidoError extends Error { }

/**
 * 💳 Pago por transferencia de los pedidos web:
 *  - el cliente (o invitado, con el link de su pedido) sube el comprobante;
 *  - un administrador lo ve y confirma o rechaza el pago.
 */
@Injectable({ providedIn: 'root' })
export class PagoPedidosService {

  constructor(private firestore: Firestore, private storage: Storage, private auditoria: AuditoriaService) { }

  /** El pedido por su id (pendiente o finalizado), para el link del cliente */
  async pedido(id: string): Promise<{ coleccion: string; pedido: any } | null> {
    for (const coleccion of ['Pedidos Pendientes', 'Pedidos Finalizados']) {
      const snap = await getDoc(doc(this.firestore, coleccion, id));
      if (snap.exists()) return { coleccion, pedido: { id: snap.id, ...(snap.data() as any) } };
    }
    return null;
  }

  /**
   * Sube el comprobante y deja el pago "por verificar".
   * @returns el comprobante guardado
   */
  async subirComprobante(pedidoId: string, archivo: File, pagoActual: PagoTransferencia | null | undefined): Promise<ComprobantePago> {
    const error = errorComprobante(archivo);
    if (error) throw new PagoPedidoError(error);
    if (!puedeSubirComprobante(pagoActual)) throw new PagoPedidoError('Este pedido ya no recibe comprobantes.');
    const ahora = new Date();
    const path = rutaComprobante(pedidoId, archivo.name, ahora);
    const tipo = tipoComprobante(archivo);
    await uploadBytes(ref(this.storage, path), archivo, { contentType: tipo });
    const comprobante: ComprobantePago = { path, nombre: String(archivo.name || 'comprobante').slice(0, 120), tipo, tamano: archivo.size, fecha: ahora.toISOString() };
    await updateDoc(doc(this.firestore, 'Pedidos Pendientes', pedidoId), {
      'pagoTransferencia.estado': 'por-verificar',
      'pagoTransferencia.comprobantes': arrayUnion(comprobante),
      'pagoTransferencia.ultimoComprobante': comprobante.fecha
    });
    return comprobante;
  }

  /** Link para ver el comprobante (solo administradores con permiso de Pedidos) */
  urlComprobante(c: ComprobantePago): Promise<string> {
    return getDownloadURL(ref(this.storage, c.path));
  }

  async confirmar(pedido: any): Promise<void> {
    await this.resolver(pedido, 'aprobado', null);
  }

  async rechazar(pedido: any, motivo: string): Promise<void> {
    const m = String(motivo || '').trim();
    if (!m) throw new PagoPedidoError('Escribí el motivo del rechazo (lo ve el cliente).');
    await this.resolver(pedido, 'rechazado', m.slice(0, 200));
  }

  private async resolver(pedido: any, estado: 'aprobado' | 'rechazado', motivo: string | null) {
    if (!pedido?.id || !pedido?.pagoTransferencia) throw new PagoPedidoError('Este pedido no tiene pago por transferencia.');
    const usuario: any = this.auditoria.getUsuarioActual();
    const antes = pedido.pagoTransferencia.estado;
    await updateDoc(doc(this.firestore, 'Pedidos Pendientes', pedido.id), {
      'pagoTransferencia.estado': estado,
      'pagoTransferencia.motivoRechazo': motivo,
      'pagoTransferencia.verificadoPor': usuario ? { uid: usuario.uid || '', nombre: usuario.nombre || usuario.usuario || '' } : null,
      'pagoTransferencia.verificadoEn': new Date().toISOString()
    });
    this.auditoria.registrar({
      accion: 'modificar',
      entidad: 'Pedidos Pendientes',
      entidadId: pedido.id,
      descripcion: estado === 'aprobado'
        ? `Confirmó el pago por transferencia del pedido #${pedido.nroPedido ?? '?'}`
        : `Rechazó el pago por transferencia del pedido #${pedido.nroPedido ?? '?'}: ${motivo}`,
      antes: { estadoPago: antes },
      despues: { estadoPago: estado }
    });
  }
}
