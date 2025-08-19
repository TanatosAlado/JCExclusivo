import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';
import { Orden } from 'src/app/modules/admin/models/orden.model'; 

@Component({
  selector: 'app-comprobante-orden',
  templateUrl: './comprobante-orden.component.html',
  styleUrls: ['./comprobante-orden.component.css']
})
export class ComprobanteOrdenComponent {
  qrLink: string;

  constructor(@Inject(MAT_DIALOG_DATA) public orden: Orden) {
    this.qrLink = `https://storejcexclusivo.web.app/consulta/${orden.id}`;
  }

  imprimir() {
    window.print();
  }
}