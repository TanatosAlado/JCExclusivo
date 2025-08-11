import { ChangeDetectorRef, Component, ViewChild } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { AltaOrdenComponent } from '../alta-orden/alta-orden.component';
import { Orden } from 'src/app/modules/admin/models/orden.model';
import { MatTableDataSource } from '@angular/material/table';
import { MatPaginator } from '@angular/material/paginator';
import { OrdenesService } from 'src/app/modules/admin/services/ordenes.service';
import { PedidosService } from 'src/app/shared/services/pedidos.service';

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

  constructor(private dialog: MatDialog, private ordenesService: OrdenesService,private cdRef: ChangeDetectorRef) { 

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
        console.log('Producto creado:', resultado);
     //   this.obtenerProductos(); // Refrescar productos
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
    // mostrar detalle
  }

  editarOrden(orden: Orden) {
    // redirigir a formulario con datos cargados
  }

  eliminarOrden(orden: Orden) {
    // abrir confirmación y eliminar
  }

}


