import { Component } from '@angular/core';
import { collection, Firestore, getDocs } from 'firebase/firestore';
import { Marquesina } from 'src/app/modules/admin/models/marquesina.model';
import { MarquesinaService } from 'src/app/modules/admin/services/marquesina.service';


@Component({
  selector: 'app-estilo-marquesina',
  templateUrl: './estilo-marquesina.component.html',
  styleUrls: ['./estilo-marquesina.component.css']
})
export class EstiloMarquesinaComponent {


   marquesinas: Marquesina[] = [];

constructor(
  private marquesinaService: MarquesinaService
) {}

async ngOnInit() {
  await this.getTipoUsuarioMarquesina();
}

async getTipoUsuarioMarquesina() {

  const usuarioGuardado = localStorage.getItem('clienteActual');
  

  // POR DEFECTO: MINORISTA
  let tipoCliente = 'Minorista';

  if (usuarioGuardado) {
    const usuario = JSON.parse(usuarioGuardado);

    if (usuario.esMayorista === true) {
      tipoCliente = 'Mayorista';
    }
  }
  this.marquesinas =
    await this.marquesinaService.getMarquesinasPorTipo(tipoCliente);

}
}