import { Component } from '@angular/core';
import { AnalyticsService } from './shared/services/analytics.service';
import { aplicarPaletaGuardada } from './shared/utils/paleta-colores';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent {
  title = 'jcexclusivo';

  constructor(analytics: AnalyticsService) {
    // Google Analytics: solo la tienda (ver AnalyticsService)
    analytics.iniciar();
    // 🎨 Colores de prueba elegidos en este navegador (solo admins; ver PaletaColoresComponent)
    aplicarPaletaGuardada();
  }
}
