import { Component } from '@angular/core';
import { BannerService } from 'src/app/modules/admin/services/banner.service'; 

declare var bootstrap: any;

@Component({
  selector: 'app-banner',
  templateUrl: './banner.component.html',
  styleUrls: ['./banner.component.css']
})
export class BannerComponent {

  mediaItems: { nombre: string, url: string, tipo: 'imagen' | 'video' }[] = [];


  constructor(private bannerService: BannerService) { }

  ngOnInit(): void {
    this.cargarImagenes();
  }

  private esVideo(ext: string): boolean {
    return ['mp4', 'webm', 'ogg'].includes(ext);
  }

  private esImagen(ext: string): boolean {
    return ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext);
  }

  async cargarImagenes() {
    const archivos = await this.bannerService.listarArchivos('uploads');

    this.mediaItems = archivos.map(item => {
      const ext = item.nombre.split('.').pop()?.toLowerCase() || '';
      let tipo: 'imagen' | 'video' = this.esVideo(ext) ? 'video' : 'imagen';
      return { ...item, tipo };
    });

    setTimeout(() => {
      const el = document.querySelector('#bannerCarousel');
      if (el) {
        const carousel = bootstrap.Carousel.getOrCreateInstance(el, {
          interval: 3000,
          ride: 'carousel',
          pause: false
        });
        carousel.cycle();
      }
    });
  }



}
