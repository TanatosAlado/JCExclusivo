import { Injectable } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { avisoSolicitud } from '../utils/solicitud-mayorista';

/**
 * Avisa al cliente cómo está su solicitud de cuenta mayorista (en revisión, aprobada o rechazada).
 * Cada novedad se muestra una sola vez por navegador.
 */
@Injectable({ providedIn: 'root' })
export class AvisoMayoristaService {

  constructor(private snackBar: MatSnackBar) { }

  mostrar(cliente: any): void {
    const aviso = avisoSolicitud(cliente);
    if (!aviso) return;
    try {
      if (localStorage.getItem(aviso.clave)) return;
      localStorage.setItem(aviso.clave, '1');
    } catch { /* sin almacenamiento: se muestra igual */ }
    this.snackBar.open(aviso.texto, 'Entendido', {
      duration: aviso.tipo === 'info' ? 7000 : 12000,
      horizontalPosition: 'center',
      verticalPosition: 'bottom',
      // Clases globales de styles.css (verde / rojo; el aviso "en revisión" va con el estilo normal)
      panelClass: ['estilosSnackBar', ...(aviso.tipo === 'ok' ? ['background-color-green'] : aviso.tipo === 'mal' ? ['background-color-red'] : [])]
    });
  }
}
