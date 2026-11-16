import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { take } from 'rxjs/operators';
import { InfoEmpresaService } from '../../services/info-empresa.service';
import { PagoPedidoError, PagoPedidosService } from '../../services/pago-pedidos.service';
import { InfoEmpresa } from '../../models/infoEmpresa.model';
import { DatosTransferencia, PagoTransferencia, TEXTO_ESTADO_PAGO, datosTransferencia, errorComprobante, puedeSubirComprobante, textoTamano } from '../../utils/pago-web';

/**
 * 🔗 Link del pedido web (/pedido/:id): el cliente o el invitado ve su pedido, el estado del pago
 * y puede subir el comprobante de la transferencia.
 */
@Component({
  selector: 'app-pedido-pago',
  templateUrl: './pedido-pago.component.html',
  styleUrls: ['./pedido-pago.component.css']
})
export class PedidoPagoComponent implements OnInit {

  cargando = true;
  error: string | null = null;
  pedido: any = null;
  coleccion = '';
  infoEmpresa: InfoEmpresa | null = null;
  archivo: File | null = null;
  errorArchivo: string | null = null;
  subiendo = false;
  subidoRecien = false;
  readonly textoEstado = TEXTO_ESTADO_PAGO;
  readonly textoTamano = textoTamano;

  constructor(private route: ActivatedRoute, private pagos: PagoPedidosService, private infoEmpresaService: InfoEmpresaService) { }

  async ngOnInit() {
    this.infoEmpresaService.obtenerInfoGeneral().pipe(take(1)).subscribe(i => this.infoEmpresa = i);
    await this.cargar();
  }

  async cargar() {
    const id = this.route.snapshot.paramMap.get('id') || '';
    this.cargando = true;
    this.error = null;
    try {
      const r = id ? await this.pagos.pedido(id) : null;
      if (!r) { this.error = 'No encontramos ese pedido. Revisá el link.'; return; }
      this.pedido = r.pedido;
      this.coleccion = r.coleccion;
    } catch (e) {
      console.error('Error leyendo el pedido', e);
      this.error = 'No pudimos cargar el pedido. Probá de nuevo en un rato.';
    } finally {
      this.cargando = false;
    }
  }

  get pago(): PagoTransferencia | null {
    return this.pedido?.pagoTransferencia || null;
  }

  /** A dónde transferir: lo que quedó guardado en el pedido (si no, el alias minorista de hoy) */
  get destino(): DatosTransferencia {
    const p = this.pago;
    if (p?.alias || p?.cvu) return { alias: p.alias || null, cvu: p.cvu || null, titular: p.titular || null, dni: p.dni || null };
    return datosTransferencia(this.infoEmpresa, false);
  }

  get puedeSubir(): boolean {
    return puedeSubirComprobante(this.pago, this.coleccion);
  }

  get entregado(): boolean {
    return this.coleccion === 'Pedidos Finalizados';
  }

  elegir(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const a = input.files?.[0] || null;
    this.errorArchivo = a ? errorComprobante(a) : null;
    this.archivo = a && !this.errorArchivo ? a : null;
    if (this.errorArchivo) input.value = '';
  }

  async subir(input?: HTMLInputElement) {
    if (!this.archivo || this.subiendo || !this.pedido) return;
    this.subiendo = true;
    this.errorArchivo = null;
    try {
      await this.pagos.subirComprobante(this.pedido.id, this.archivo, this.pago);
      this.archivo = null;
      if (input) input.value = '';
      this.subidoRecien = true;
      await this.cargar();
    } catch (e: any) {
      console.error('No se pudo subir el comprobante', e);
      this.errorArchivo = e instanceof PagoPedidoError ? e.message : 'No pudimos subir el comprobante. Probá de nuevo.';
    } finally {
      this.subiendo = false;
    }
  }

  generarQR(aliasOCvu: string): string {
    return `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(aliasOCvu)}&size=180x180`;
  }

  copiar(texto: string | undefined) {
    if (texto) navigator.clipboard?.writeText(texto).catch(() => { });
  }
}
