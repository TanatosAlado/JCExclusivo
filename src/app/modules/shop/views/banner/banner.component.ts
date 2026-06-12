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

  constructor(
    private bannerService: BannerService,
    private authService: AuthService
  ) {}

  ngOnInit(): void {
    this.authService.getUsuarioActual().subscribe(async cliente => {
      this.esMayorista = cliente?.esMayorista ?? false;

      const carpeta = this.esMayorista
        ? 'uploads/mayorista'
        : 'uploads/minorista';

      await this.cargarBanners(carpeta);
    });
  }

  async cargarBanners(carpeta: string) {
    const archivos = await this.bannerService.listarArchivos(carpeta);

    this.mediaItems = archivos.map(a => ({
      nombre: a.nombre,
      url: a.url,
      tipo: this.obtenerTipo(a.nombre)
    }));
  }

  obtenerTipo(nombre: string): 'imagen' | 'video' {
    const ext = nombre.split('.').pop()?.toLowerCase();

    if (ext === 'mp4' || ext === 'webm' || ext === 'ogg') {
      return 'video';
    }
    return 'imagen';
  }
}