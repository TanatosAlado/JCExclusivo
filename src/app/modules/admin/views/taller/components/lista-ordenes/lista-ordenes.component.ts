import { Component } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { AltaOrdenComponent } from '../alta-orden/alta-orden.component';

@Component({
  selector: 'app-lista-ordenes',
  templateUrl: './lista-ordenes.component.html',
  styleUrls: ['./lista-ordenes.component.css']
})
export class ListaOrdenesComponent {

  constructor(private dialog: MatDialog) { }

  

    abrirModalAltaProducto(): void {
    const dialogRef = this.dialog.open(AltaOrdenComponent, {
      width: '90vw',
      maxWidth: '600px',
      height: 'auto',
      maxHeight: '90vh',
      panelClass: 'custom-dialog-container',
      
    });
  
    dialogRef.afterClosed().subscribe(resultado => {
      if (resultado) {
        console.log('Producto creado:', resultado);
     //   this.obtenerProductos(); // Refrescar productos
      }
    });
  }

}


