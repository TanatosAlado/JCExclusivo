import { Injectable, NgZone } from '@angular/core';
import { Firestore, collection, onSnapshot, query, where } from '@angular/fire/firestore';
import { BehaviorSubject, Subject } from 'rxjs';
import { AvisoAdmin, TipoAvisoAdmin, avisoDeMayorista, avisoDePedido, avisosNuevos, ordenarAvisos } from '../utils/avisos-admin';

/**
 * 🔔 Escucha en vivo (con la página abierta) lo que necesita atención de un administrador:
 *  pedidos web pendientes y solicitudes mayoristas pendientes.
 *  - avisos$: lo pendiente ahora (baja solo cuando se procesa).
 *  - nuevo$: cada cosa que entra mientras la página está abierta (para el aviso flotante).
 */
@Injectable({ providedIn: 'root' })
export class AvisosAdminService {

  readonly avisos$ = new BehaviorSubject<AvisoAdmin[]>([]);
  readonly nuevo$ = new Subject<AvisoAdmin>();

  private porTipo: { [t in TipoAvisoAdmin]?: AvisoAdmin[] } = {};
  private conocidos: { [t in TipoAvisoAdmin]?: Set<string> } = {};
  private cancelar: (() => void)[] = [];
  private clave = '';

  constructor(private firestore: Firestore, private zone: NgZone) { }

  /** Empieza a escuchar según los permisos (si ya escuchaba lo mismo, no hace nada) */
  iniciar(permisos: { pedidos: boolean; mayoristas: boolean }) {
    const clave = `${permisos.pedidos}|${permisos.mayoristas}`;
    if (clave === this.clave) return;
    this.detener();
    this.clave = clave;
    if (permisos.pedidos) {
      this.escuchar('pedido', collection(this.firestore, 'Pedidos Pendientes'), (id, d) => avisoDePedido(id, d));
    }
    if (permisos.mayoristas) {
      this.escuchar('mayorista', query(collection(this.firestore, 'Clientes'), where('solicitudMayorista.estado', '==', 'pendiente')),
        (id, d) => avisoDeMayorista(id, d));
    }
  }

  detener() {
    this.cancelar.forEach(c => { try { c(); } catch { } });
    this.cancelar = [];
    this.porTipo = {};
    this.conocidos = {};
    this.clave = '';
    this.avisos$.next([]);
  }

  private escuchar(tipo: TipoAvisoAdmin, ref: any, armar: (id: string, d: any) => AvisoAdmin) {
    const cancelar = onSnapshot(ref, (snap: any) => {
      this.zone.run(() => {
        const lista: AvisoAdmin[] = snap.docs.map((d: any) => armar(d.id, d.data()));
        for (const a of ordenarAvisos(avisosNuevos(this.conocidos[tipo] || null, lista)).reverse()) this.nuevo$.next(a);
        this.conocidos[tipo] = new Set(lista.map(a => a.id));
        this.porTipo[tipo] = lista;
        this.avisos$.next(ordenarAvisos([...(this.porTipo.pedido || []), ...(this.porTipo.mayorista || [])]));
      });
    }, (err: any) => console.warn('No se pudieron escuchar los avisos de ' + tipo, err));
    this.cancelar.push(cancelar);
  }
}
