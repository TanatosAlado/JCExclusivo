import { Component } from '@angular/core';
import { InfoEmpresaService } from '../../services/info-empresa.service';
import { InfoEmpresa } from '../../models/infoEmpresa.model';

@Component({
  selector: 'app-whatsapp',
  templateUrl: './whatsapp.component.html',
  styleUrls: ['./whatsapp.component.css']
})
export class WhatsappComponent {

   infoEmpresa: InfoEmpresa | null = null;

  constructor(private infoEmpresaService: InfoEmpresaService){}

ngOnInit() {
  this.infoEmpresaService.obtenerInfoGeneral().subscribe(info => {
    this.infoEmpresa = info;
  });
}
}
