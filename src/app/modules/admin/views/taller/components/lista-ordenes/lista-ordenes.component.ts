import { ChangeDetectorRef, Component, ViewChild } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { AltaOrdenComponent } from '../alta-orden/alta-orden.component';
import { Orden } from 'src/app/modules/admin/models/orden.model';
import { MatTableDataSource } from '@angular/material/table';
import { MatPaginator } from '@angular/material/paginator';
import { OrdenesService } from 'src/app/modules/admin/services/ordenes.service';
import { PedidosService } from 'src/app/shared/services/pedidos.service';
import { DetalleOrdenComponent } from '../detalle-orden/detalle-orden.component';
import { EdicionOrdenComponent } from '../edicion-orden/edicion-orden.component';
import { VerOrdenComponent } from '../ver-orden/ver-orden.component';
import { ToastService } from 'src/app/shared/services/toast.service';
import { ConfirmDialogComponent } from 'src/app/shared/components/confirm-dialog/confirm-dialog.component';

@Component({
  selector: 'app-lista-ordenes',
  templateUrl: './lista-ordenes.component.html',
  styleUrls: ['./lista-ordenes.component.css']
})
export class ListaOrdenesComponent {

  ordenesPendientes: Orden[] = [];
  ordenesFinalizadas: Orden[] = [];
  ordenesEliminadas: Orden[] = [];
  activeTab: number = 1;
  datasourceOrdenesPendientes: MatTableDataSource<Orden>
  datasourceOrdenesFinalizadas: MatTableDataSource<Orden>
  datasourceOrdenesEliminadas: MatTableDataSource<Orden>
  paginator!: MatPaginator;
  @ViewChild('paginatorOrdenesPendientes') paginatorOrdenesPendientes!: MatPaginator;
  @ViewChild('paginatorOrdenesFinalizados') paginatorOrdenesFinalizadas!: MatPaginator;
  @ViewChild('paginatorOrdenesEliminados') paginatorOrdenesEliminadas!: MatPaginator;
  displayedColumns: string[] = ['numeroOrden', 'cliente', 'imei', 'equipo', 'estado', 'fechaIngreso', 'acciones'];

  constructor(private dialog: MatDialog, private ordenesService: OrdenesService,private cdRef: ChangeDetectorRef, private toastService:ToastService) { 

    this.datasourceOrdenesPendientes = new MatTableDataSource(this.ordenesPendientes);
    this.datasourceOrdenesFinalizadas = new MatTableDataSource(this.ordenesFinalizadas);
    this.datasourceOrdenesEliminadas = new MatTableDataSource(this.ordenesEliminadas);
  }

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

    ngAfterViewInit() {
    this.setDataSourceAttributes()
  }

  setDataSourceAttributes() {
     if (this.datasourceOrdenesPendientes && this.activeTab===1) {
      this.datasourceOrdenesPendientes.paginator = this.paginator;
    }

    if (this.datasourceOrdenesFinalizadas&& this.activeTab===2) {
      this.datasourceOrdenesFinalizadas.paginator = this.paginator;
    }
     if (this.datasourceOrdenesFinalizadas&& this.activeTab===3) {
      this.datasourceOrdenesFinalizadas.paginator = this.paginator;
    }
  }

  obtenerOrdenes(): void {
    this.ordenesService.getOrdenPorTipo('Ordenes Pendientes').subscribe(data => {
      this.ordenesPendientes = data.sort((a, b) => b.numeroOrden - a.numeroOrden);
      this.datasourceOrdenesPendientes = new MatTableDataSource(this.ordenesPendientes);
      this.datasourceOrdenesPendientes.paginator = this.paginatorOrdenesPendientes;
      this.cdRef.detectChanges();
    });

    this.ordenesService.getOrdenPorTipo('Ordenes Finalizadas').subscribe(data => {
      this.ordenesFinalizadas = data.sort((a, b) => b.numeroOrden - a.numeroOrden);
      this.datasourceOrdenesFinalizadas = new MatTableDataSource(this.ordenesFinalizadas);
      this.datasourceOrdenesPendientes.paginator = this.paginatorOrdenesFinalizadas;
      this.cdRef.detectChanges();
    });

    this.ordenesService.getOrdenPorTipo('Ordenes Eliminadas').subscribe(data => {
      this.ordenesEliminadas = data.sort((a, b) => b.numeroOrden - a.numeroOrden);
      this.datasourceOrdenesEliminadas = new MatTableDataSource(this.ordenesEliminadas);
      this.datasourceOrdenesEliminadas.paginator = this.paginatorOrdenesEliminadas;
      this.cdRef.detectChanges();
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
      console.log('Orden creada:', resultado);
      // Podrías refrescar la lista de órdenes acá si querés
    }
  });
}

  applyFilter(event: Event, dataSource: MatTableDataSource<any>): void {
    const filterValue = (event.target as HTMLInputElement).value;
    dataSource.filter = filterValue.trim().toLowerCase();
  }

  setPaginator(tab:number){
   this.activeTab = tab;
  this.setDataSourceAttributes();

  }

  verOrden(orden: Orden) {
    console.log(orden)
      this.dialog.open(VerOrdenComponent, {
      width: '500px',
      data: orden
    });
  }

  editarOrden(orden: Orden) {
     const dialogRef = this.dialog.open(EdicionOrdenComponent, {
           width: '600px',
           data: orden,  // Enviar los datos del producto a editar
         });
     
         dialogRef.afterClosed().subscribe((resultado) => {
           if (resultado) {
             this.ordenesService.actualizarOrden(resultado.id,resultado)
             .then(() => {
               this.obtenerOrdenes(); // Refrescar la lista después de cerrar el modal
             })
             .catch(error => {
             });
           }
         });
  }

  

  eliminarOrden(orden: Orden) {
    // abrir confirmación y eliminar
  }

    moverDocumento(id: string, origen: string, destino: string) {
    this.ordenesService.moverDocumento(id, origen, destino)
      .then(() => {
        if ((origen == 'Ordenes Pendientes') && (destino == 'Ordenes Finalizadas')) {
          this.toastService.toastMessage('Orden finalizada con éxito', 'green', 2000);
        } else if ((origen == 'Ordenes Pendientes') && (destino == 'Ordenes Eliminadas')) {
          this.toastService.toastMessage('Orden eliminada con éxito', 'green', 2000);
        } else if ((origen == 'Ordenes Finalizadas') && (destino == 'Ordenes Pendientes')) {
          this.toastService.toastMessage('Orden regresada a pendientes con éxito', 'green', 2000);
        } else if ((origen == 'Orden Finalizadas') && (destino == 'Ordenes Eliminadas')) {
          this.toastService.toastMessage('Orden eliminado con éxito', 'green', 2000);
        } else if ((origen == 'Ordenes Eliminadas') && (destino == 'Ordenes Pendientes')) {
          this.toastService.toastMessage('Orden regresado a pendientes con éxito', 'green', 2000);
        }
        //this.getPedidos();
      })
  }

  openConfirmDialog(id: string, tabla: string) {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        message: `¿Está seguro que desea eliminar esta órden?`,
        confirmAction: () => this.moverDocumento(id, tabla, 'Ordenes Eliminadas') // Acción a ejecutar si se confirma
      }
    });
  }
}


