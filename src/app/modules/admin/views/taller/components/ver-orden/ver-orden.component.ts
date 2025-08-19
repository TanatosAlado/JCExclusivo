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

  // Obtenemos el canvas del QR
  const canvasQR: HTMLCanvasElement | null = this.qrCodeRef?.nativeElement?.querySelector('canvas');
  const qrDataUrl = canvasQR ? canvasQR.toDataURL('image/png') : '';

  // HTML de la orden sin el logo original
  const detalleOrden = document.getElementById('detalleOrden');
  if (detalleOrden) {
    const logoOriginal = detalleOrden.querySelector('.logo-container img');
    if (logoOriginal) logoOriginal.remove();
  }
  const ordenHTML = detalleOrden?.innerHTML;

  const printWindow = window.open('', '_blank');
  if (!printWindow) return;

  printWindow.document.open();
  printWindow.document.write(`
    <html>
    <head>
      <title>Orden de Reparación</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .orden-container { max-width: 600px; margin: auto; padding: 15px; background: #fff; border-radius: 15px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); text-align: center; font-size: 13px; }
        .bloque { text-align: left; margin-bottom: 8px; padding: 10px; border-left: 5px solid #3498db; background: #f9f9f9; border-radius: 8px; }
        .bloque h2 { font-size: 1rem; margin-bottom: 4px; color: #2980b9; }
        .bloque p, .bloque ul { margin: 2px 0; font-size: 0.9rem; color: #333; }
        .qr-container { text-align: center; margin: 10px 0 0 0; }
        .qr-text { margin-top: 3px; font-size: 0.85rem; color: #555; }
        .estado { padding: 3px 6px; background: #eaf7ea; border: 1px solid #2ecc71; color: #27ae60; border-radius: 5px; font-weight: bold; }
      </style>
    </head>
    <body>
      <div class="orden-container">
        ${logoDataUrl ? `<div class="logo-container">
          <img src="${logoDataUrl}" width="80" />
        </div>` : ''}

        ${ordenHTML}

        ${qrDataUrl ? `<div class="qr-container">
          <img src="${qrDataUrl}" width="150" height="150" />
          <p class="qr-text">Escaneá el código para seguir el estado de tu reparación 📱</p>
        </div>` : ''}
      </div>

      <script>
        window.onload = function() {
          window.print();
          window.onafterprint = function() { window.close(); }
        }
      </script>
    </body>
    </html>
  `);
  printWindow.document.close();
}
}



