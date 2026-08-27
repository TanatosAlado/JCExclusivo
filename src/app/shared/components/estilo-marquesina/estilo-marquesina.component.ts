import { Component } from '@angular/core';
import { Marquesina } from 'src/app/modules/admin/models/marquesina.model';
import { MarquesinaService } from 'src/app/modules/admin/services/marquesina.service';
import { AuthService } from 'src/app/modules/auth/services/auth.service';

@Component({
  selector: 'app-estilo-marquesina',
  templateUrl: './estilo-marquesina.component.html',
  styleUrls: ['./estilo-marquesina.component.css']
})
export class EstiloMarquesinaComponent {

  marquesinas: Marquesina[] = [];

  constructor(
    private marquesinaService: MarquesinaService,
    private authService: AuthService
  ) {}

  ngOnInit(): void {

    this.authService.getUsuarioActual().subscribe(async cliente => {

      // ==========================================
      // MINORISTA POR DEFECTO
      // ==========================================

      const esMayorista =
        cliente?.esMayorista ?? false;

      const tipoCliente =
        esMayorista
          ? 'Mayorista'
          : 'Minorista';

      // ==========================================
      // CARGAR MARQUESINAS
      // ==========================================

      this.marquesinas =
        await this.marquesinaService
          .getMarquesinasPorTipo(tipoCliente);

    });

  }
}