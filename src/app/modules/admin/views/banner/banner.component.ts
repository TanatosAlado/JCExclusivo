import { Component } from '@angular/core';
import { BannerService } from '../../services/banner.service';
import { MatDialog } from '@angular/material/dialog';
import { ConfirmDialogComponent } from 'src/app/shared/components/confirm-dialog/confirm-dialog.component';

@Component({
  selector: 'app-banner',
  templateUrl: './banner.component.html',
  styleUrls: ['./banner.component.css']
})
export class BannerComponent {


  archivoSeleccionado: File | null = null;
  subiendo = false;
  urlArchivo: string | null = null;
  archivos: { nombre: string, url: string }[] = [];
  carpeta = 'uploads';

  constructor(private bannerService: BannerService, private dialog: MatDialog) {}


    ngOnInit(): void {
    this.cargarArchivos();
  }

    onFileSelected(event: any) {
    this.archivoSeleccionado = event.target.files[0] || null;
    this.urlArchivo = null; // Limpiar URL anterior si existía
  }


  subirArchivo() {
    if (!this.archivoSeleccionado) return;

    this.subiendo = true;
    const filePath = `uploads/${Date.now()}_${this.archivoSeleccionado.name}`;

    this.bannerService.uploadFile(this.archivoSeleccionado, filePath)
      .then(url => {
        this.urlArchivo = url;
        this.subiendo = false;
      })
      .catch(error => {
        console.error('Error al subir el archivo:', error);
        this.subiendo = false;
      });
  }

    async cargarArchivos() {
    this.archivos = await this.bannerService.listarArchivos(this.carpeta);
  }

  eliminar(nombre: string) {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        message: `¿Deseás eliminar el archivo "${nombre}"?`,
        confirmAction: async () => {
          await this.bannerService.eliminarArchivo(`${this.carpeta}/${nombre}`);
          this.cargarArchivos(); // refresca el listado
        }
      }
    });
  }


}

