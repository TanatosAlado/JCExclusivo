import { Component } from '@angular/core';
import { MatTableDataSource } from '@angular/material/table';
import { Marquesina } from '../../models/marquesina.model';
import { AltaMarquesinaComponent } from './components/alta-marquesina/alta-marquesina.component';
import { MatDialog } from '@angular/material/dialog';
import { MatPaginator } from '@angular/material/paginator';
import { MarquesinaService } from '../../services/marquesina.service';
import { VerMarquesinaComponent } from './components/ver-marquesina/ver-marquesina.component';
import { EditarMarquesinaComponent } from './components/editar-marquesina/editar-marquesina.component';
import { ConfirmDialogComponent } from 'src/app/shared/components/confirm-dialog/confirm-dialog.component';
import { ToastService } from 'src/app/shared/services/toast.service';

@Component({
  selector: 'app-marquesina',
  templateUrl: './marquesina.component.html',
  styleUrls: ['./marquesina.component.css']
})
export class MarquesinaComponent {
  datasourceMarquesina: MatTableDataSource<Marquesina>
  displayedColumns: string[] = ['mensaje', 'tipoCliente', 'acciones'];
  paginator!: MatPaginator;
  marquesina: Marquesina[] = []
  marquesinaEliminar:string = '';

  constructor(public dialog: MatDialog, private marquesinaService: MarquesinaService, private toastService: ToastService) {
     this.datasourceMarquesina = new MatTableDataSource(this.marquesina)
  }

  ngOnInit() {

    this.getMarquesina();
  }

  
  //FUNCION PARA ABRIR EL MODAL DE ALTA DE MARQUESINA
  abrirModalAltaMarquesina(){
       const dialogRef = this.dialog.open(AltaMarquesinaComponent, {
            width: '90vw',
            maxWidth: '600px',
            height: 'auto',
            maxHeight: '90vh',
          });

  }

  //FUNCION PARA FILTRAR POR CUALQUIER PALABRA QUE SE ESCRIBA EN EL FILTRO
  applyFilter(event: Event, datasource: MatTableDataSource<any>) {
    const filterValue = (event.target as HTMLInputElement).value;
    datasource.filter = filterValue.trim().toLowerCase();
  }

  //FUNCION PARA TRAER LAS MARQUESINAS
 async getMarquesina() {

  this.marquesina =await this.marquesinaService.getMarquesinas();

  this.datasourceMarquesina =
    new MatTableDataSource(this.marquesina);

  this.datasourceMarquesina.paginator =
    this.paginator;
}

//FUNCION PARA EDITAR LA MARQUESINA
verMarquesina(marquesina: Marquesina) {
   this.dialog.open(VerMarquesinaComponent, {
      width: '500px',
      data: marquesina
    });
}

//FUNCION PARA EDITAR LA MARQUESINA
editarMarquesina(marquesina: Marquesina) {

    const dialogRef = this.dialog.open(EditarMarquesinaComponent, {
      width: '600px',
      data: marquesina,
    });

    dialogRef.afterClosed().subscribe((resultado) => {
      if (resultado) {
        this.marquesinaService.actualizarMarquesina(resultado)
          .then(() => {
            this.getMarquesina();
          })
          .catch(error => {
          });
      }
    });
  }


   //FUNCION PARA MOSTAR CUADRO DE DIALOGO
  openConfirmDialog(marquesina: any): void {
    this.marquesinaEliminar = marquesina.id;
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        message: `¿Está seguro que desea eliminar esta marquesina?`,
        confirmAction: () => this.eliminarMarquesina(marquesina.id)
      }
    });
  }

    //FUNCION PARA ELIMINAR UNA MARQUESINA
  eliminarMarquesina(id: string): void {
    this.marquesinaService.eliminarMarquesina(id).then(() => {
      this.toastService.toastMessage('Marquesina eliminada con éxito', 'green', 2000);
      this.getMarquesina();
    })
  }
}



