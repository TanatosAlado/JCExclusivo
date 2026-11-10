import { Component } from '@angular/core';
import { BannerService } from 'src/app/modules/admin/services/banner.service'; 
import { AuthService } from 'src/app/modules/auth/services/auth.service';

interface MediaItem {
  nombre: string;
  url: string;
  tipo: 'imagen' | 'video';
}

@Component({
  selector: 'app-banner',
  templateUrl: './banner.component.html',
  styleUrls: ['./banner.component.css']
})
export class BannerComponent {

    mediaItems: MediaItem[] = [];
  esMayorista = false;

  /** Carpeta que se está mostrando (minorista por defecto) */
  private carpetaActual: string | null = null;
  /** Para descartar respuestas viejas si el usuario cambia rápido (login / logout) */
  private pedido = 0;

  constructor(
    private bannerService: BannerService,
    private authService: AuthService
  ) {}

  ngOnInit(): void {
    // Sin sesión (o cliente minorista) → banners minoristas. Mayorista → los suyos.
    this.authService.getUsuarioActual().subscribe(cliente => {
      this.esMayorista = cliente?.esMayorista === true;
      const carpeta = this.esMayorista ? 'uploads/mayorista' : 'uploads/minorista';
      if (carpeta !== this.carpetaActual) {
        this.cargarBanners(carpeta);
      }
    });
  }

  async cargarBanners(carpeta: string) {
    this.carpetaActual = carpeta;
    const miPedido = ++this.pedido;
    try {
      const archivos = await this.bannerService.listarArchivos(carpeta);
      if (miPedido !== this.pedido) return; // llegó tarde: ya se pidió otra carpeta

      this.mediaItems = archivos.map(a => ({
        nombre: a.nombre,
        url: a.url,
        tipo: this.obtenerTipo(a.nombre)
      }));
    } catch (err: any) {
      if (miPedido !== this.pedido) return;
      // Típico: las reglas de Firebase Storage no dejan listar la carpeta a visitantes sin sesión
      console.error(`No se pudieron cargar los banners de "${carpeta}":`, err?.code || err);
      this.carpetaActual = null; // que se pueda reintentar en el próximo cambio de usuario
    }
  }

  obtenerTipo(nombre: string): 'imagen' | 'video' {
    const ext = nombre.split('.').pop()?.toLowerCase();

    if (ext === 'mp4' || ext === 'webm' || ext === 'ogg') {
      return 'video';
    }
    return 'imagen';
  }
}