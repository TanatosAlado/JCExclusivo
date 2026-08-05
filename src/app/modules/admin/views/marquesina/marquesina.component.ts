import { Component } from '@angular/core';
import { MatTableDataSource } from '@angular/material/table';
import { Marquesina } from '../../models/marquesina.model';
import { AltaMarquesinaComponent } from './components/alta-marquesina/alta-marquesina.component';
import { MatDialog } from '@angular/material/dialog';

@Component({
  selector: 'app-marquesina',
  templateUrl: './marquesina.component.html',
  styleUrls: ['./marquesina.component.css']
})
export class MarquesinaComponent {
  datasourceMarquesina: MatTableDataSource<Marquesina>
  displayedColumns: string[] = ['descripcion', 'tipoCliente', 'acciones'];

  constructor(public dialog: MatDialog) {}

  
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

}
