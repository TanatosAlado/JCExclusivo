import { Component, ViewChild } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { AltaOrdenComponent } from '../alta-orden/alta-orden.component';
import { Orden } from 'src/app/modules/admin/models/orden.model';
import { MatTableDataSource } from '@angular/material/table';
import { MatPaginator } from '@angular/material/paginator';
import { OrdenesService } from 'src/app/modules/admin/services/ordenes.service';

@Component({
  selector: 'app-lista-ordenes',
  templateUrl: './lista-ordenes.component.html',
  styleUrls: ['./lista-ordenes.component.css']
})
export class ListaOrdenesComponent {

  ordenes: Orden[] = [];
  datasourceOrdenes: MatTableDataSource<Orden>
  paginator!: MatPaginator;
  displayedColumns: string[] = ['numeroOrden', 'cliente', 'imei', 'equipo', 'estado', 'fechaIngreso', 'acciones'];

  constructor(private dialog: MatDialog, private ordenesService: OrdenesService) { }

  ngOnInit(): void {
    this.obtenerOrdenes();
  }

     @ViewChild(MatPaginator) set matPaginator(mp: MatPaginator) {
      if (mp) {
        this.paginator = mp;
        this.paginator._intl.itemsPerPageLabel = 'Ordenes por Página';
        this.paginator._intl.firstPageLabel = 'Primera Página';
        this.paginator._intl.previousPageLabel = 'Página Anterior';
        this.paginator._intl.nextPageLabel = 'Siguiente Página';
        this.paginator._intl.lastPageLabel = 'Última Página';
      }
      this.setDataSourceAttributes();
    }

  setDataSourceAttributes() {
    if (this.datasourceOrdenes) {
      this.datasourceOrdenes.paginator = this.paginator;
    }
  }

  obtenerOrdenes(): void {
    this.ordenesService.obtenerOrdenes().subscribe((ordenes: Orden[]) => {
      this.ordenes = ordenes;
      
      
      this.datasourceOrdenes = new MatTableDataSource(this.ordenes);
      this.datasourceOrdenes.paginator = this.paginator;
    });
  }

  

    abrirModalAltaOrden(): void {
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

  applyFilter(event: Event, dataSource: MatTableDataSource<any>): void {
    const filterValue = (event.target as HTMLInputElement).value;
    dataSource.filter = filterValue.trim().toLowerCase();
  }

  verOrden(orden: Orden) {
    // mostrar detalle
  }

  editarOrden(orden: Orden) {
    // redirigir a formulario con datos cargados
  }

  eliminarOrden(orden: Orden) {
    // abrir confirmación y eliminar
  }

}


