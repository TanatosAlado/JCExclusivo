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
    esMayorista: boolean = false;

  bannersMayorista: MediaItem[] = [
    {
      nombre: 'banner01',
      url: 'assets/imagenes/mayorista/banner01.JPG',
      tipo: 'imagen'
    },
    {
      nombre: 'banner04',
      url: 'assets/imagenes/mayorista/banner04.JPG',
      tipo: 'imagen'
    }
  ];

  bannersMinorista: MediaItem[] = [
    {
      nombre: 'banner02',
      url: 'assets/imagenes/minorista/banner02.JPG',
      tipo: 'imagen'
    },
    {
      nombre: 'banner03',
      url: 'assets/imagenes/minorista/banner03.JPG',
      tipo: 'imagen'
    },
    {
      nombre: 'banner05',
      url: 'assets/imagenes/minorista/banner05.JPG',
      tipo: 'imagen'
    }
  ];


  constructor(private bannerService: BannerService, private authService: AuthService) { }

  ngOnInit(): void {

    this.mediaItems = this.bannersMinorista;

    this.authService.getUsuarioActual().subscribe(cliente => {
      this.esMayorista = cliente?.esMayorista ?? false;

      if (this.esMayorista) {
        this.mediaItems = this.bannersMayorista;
      }
    });
  }

}
