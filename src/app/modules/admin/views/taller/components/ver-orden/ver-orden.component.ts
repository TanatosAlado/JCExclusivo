import { Component, ElementRef, Inject, ViewChild } from '@angular/core';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';
import { QRCodeComponent } from 'angularx-qrcode';

@Component({
  selector: 'app-ver-orden',
  templateUrl: './ver-orden.component.html',
  styleUrls: ['./ver-orden.component.css']
})
export class VerOrdenComponent {

  qrLink: string;
  @ViewChild('qrCode', { read: ElementRef }) qrCodeRef!: ElementRef;

  constructor(@Inject(MAT_DIALOG_DATA) public orden: any) {
    this.qrLink = `https://storejcexclusivo.web.app/consulta/${orden.id}`;
  }

  cerrarDetalle(){

  }

  imprimir() {
  // Convertir logo a base64
  const logoImg: HTMLImageElement | null = document.querySelector('.logo-container img');
  let logoDataUrl = '';
  if (logoImg) {
    const canvasLogo = document.createElement('canvas');
    canvasLogo.width = logoImg.naturalWidth;
    canvasLogo.height = logoImg.naturalHeight;
    const ctx = canvasLogo.getContext('2d');
    if (ctx) ctx.drawImage(logoImg, 0, 0);
    logoDataUrl = canvasLogo.toDataURL('image/png');
  }

  // Canvas del QR
  const canvasQR: HTMLCanvasElement | null = this.qrCodeRef?.nativeElement?.querySelector('canvas');
  const qrDataUrl = canvasQR ? canvasQR.toDataURL('image/png') : '';

  const orden = this.orden;

  const printWindow = window.open('', '_blank');
  if (!printWindow) return;

  printWindow.document.open();
  printWindow.document.write(
    '<html>' +
    '<head>' +
      '<title>Orden de Reparación</title>' +
      '<style>' +
        'body { font-family: Arial, sans-serif; margin: 20px; }' +
        '.orden-container { max-width: 600px; margin: auto; padding: 15px; background: #fff; border-radius: 15px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); text-align: center; font-size: 13px; }' +
        '.bloque { text-align: left; margin-bottom: 10px; padding: 11px; border-left: 5px solid #3498db; background: #f9f9f9; border-radius: 8px; }' +
        '.bloque h2 { font-size: 1rem; margin-bottom: 8px; color: #2980b9; }' +
        '.bloque p, .bloque ul { margin: 4px 0; font-size: 0.9rem; color: #333; }' +
        '.qr-container { text-align: center; margin: 10px 0; }' +
        '.qr-text { margin-top: 5px; font-size: 0.85rem; color: #555; }' +
        '.estado { padding: 3px 6px; background: #eaf7ea; border: 1px solid #2ecc71; color: #27ae60; border-radius: 5px; font-weight: bold; }' +
      '</style>' +
    '</head>' +
    '<body>' +
      '<div class="orden-container">' +
        (logoDataUrl ? '<div class="logo-container"><img src="' + logoDataUrl + '" width="80" /></div>' : '') +
        '<h1 class="titulo">Orden de Reparación</h1>' +

        '<div class="bloque">' +
          '<h2>👤 Datos del cliente</h2>' +
          '<p><strong>Nombre:</strong> ' + orden.apellidoCliente + ', ' + orden.nombreCliente + '</p>' +
          '<p><strong>Teléfono:</strong> ' + orden.telefonoCliente + '</p>' +
        '</div>' +

        '<div class="bloque">' +
          '<h2>💻 Datos del equipo</h2>' +
          '<p><strong>Equipo:</strong> ' + orden.equipo + '</p>' +
          (orden.colorEquipo ? '<p><strong>Color:</strong> ' + orden.colorEquipo + '</p>' : '') +
          (orden.imei ? '<p><strong>IMEI:</strong> ' + orden.imei + '</p>' : '') +
        '</div>' +

        '<div class="bloque">' +
          '<h2>📝 Detalles de la orden</h2>' +
          '<p><strong>Nro. Orden:</strong> ' + orden.numeroOrden + '</p>' +
          '<p><strong>Fecha Ingreso:</strong> ' + orden.fechaIngreso?.toDate() + '</p>' +
          (orden.fechaEntrega ? '<p><strong>Fecha Entrega:</strong> ' + orden.fechaEntrega?.toDate() + '</p>' : '') +
          '<p><strong>Motivo Ingreso:</strong> ' + orden.motivoIngreso + '</p>' +
          (orden.presupuesto && orden.presupuesto > 0 ? '<p><strong>Presupuesto:</strong> ' + orden.presupuesto + '</p>' : '') +
          '<p><strong>Estado:</strong> <span class="estado">' + orden.estado + '</span></p>' +
          '<p><strong>Garantía:</strong> ' + (orden.garantia ? 'Sí' : 'No') + '</p>' +
          (orden.diasGarantia && orden.diasGarantia > 0 ? '<p><strong>Días Garantía:</strong> ' + orden.diasGarantia + '</p>' : '') +
          (orden.fechaGarantia ? '<p><strong>Fecha Garantía:</strong> ' + orden.fechaGarantia + '</p>' : '') +
          (orden.observaciones?.length ? '<strong>Observaciones:</strong><ul>' + orden.observaciones.map((o: string) => '<li>' + o + '</li>').join('') + '</ul>' : '') +
        '</div>' +

        (qrDataUrl ? '<div class="qr-container"><img src="' + qrDataUrl + '" width="150" height="150" /><p class="qr-text">Escaneá el código para seguir el estado de tu reparación 📱</p></div>' : '') +
      '</div>' +

      '<script>' +
        'window.onload = function() { window.print(); window.onafterprint = function() { window.close(); }; }' +
      '</script>' +
    '</body>' +
    '</html>'
  );
  printWindow.document.close();
}


}



