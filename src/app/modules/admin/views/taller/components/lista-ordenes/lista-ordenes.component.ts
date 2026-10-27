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
import { ArticulosOrdenComponent } from '../articulos-orden/articulos-orden.component';
import { ArticulosOrdenService, articulosActivos } from 'src/app/modules/admin/services/articulos-orden.service';
import Swal from 'sweetalert2';

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
  displayedColumns: string[] = ['numeroOrden', 'cliente', 'imei', 'equipo', 'estado', 'fechaIngreso', 'pago', 'acciones'];
  displayedColumnsFinalizadas: string[] = [ 'numeroOrden', 'cliente', 'imei', 'equipo', 'fechaIngreso', 'fechaEntrega', 'garantia', 'pago', 'acciones' ];

  constructor(private dialog: MatDialog, private ordenesService: OrdenesService,private cdRef: ChangeDetectorRef, private toastService:ToastService,
    private articulosOrden: ArticulosOrdenService) { 

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
    if (this.datasourceOrdenesEliminadas && this.activeTab === 3) {
        this.datasourceOrdenesEliminadas.paginator = this.paginator;
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
      this.ordenesFinalizadas = data.sort((a: any, b: any) => {
        const fechaA = a.fechaEntrega?.seconds ?? 0;
        const fechaB = b.fechaEntrega?.seconds ?? 0;
        return fechaB - fechaA;
      });
      this.datasourceOrdenesFinalizadas = new MatTableDataSource(this.ordenesFinalizadas);
      this.datasourceOrdenesFinalizadas.paginator = this.paginatorOrdenesFinalizadas;
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
      //console.log('Orden creada:', resultado);
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

  actualizarPaginadores(): void {
    if (this.datasourceOrdenesPendientes) {
      this.datasourceOrdenesPendientes.paginator = this.paginatorOrdenesPendientes;
    }
    if (this.datasourceOrdenesFinalizadas) {
      this.datasourceOrdenesFinalizadas.paginator = this.paginatorOrdenesFinalizadas;
    }
    if (this.datasourceOrdenesEliminadas) {
      this.datasourceOrdenesEliminadas.paginator = this.paginatorOrdenesEliminadas;
    }
  }

  moverDocumento(id: string, origen: string, destino: string) {
    this.ordenesService.moverDocumento(id, origen, destino)
    .then(() => {
      this.toastService.toastMessage(
        'Orden actualizada correctamente',
        'green',
        2000
      );

      setTimeout(() => {
        this.setDataSourceAttributes();
      });
      // this.cdRef.detectChanges();
      // this.actualizarPaginadores();
    });
      // .then(() => {
      //   if ((origen == 'Ordenes Pendientes') && (destino == 'Ordenes Finalizadas')) {
      //     this.toastService.toastMessage('Orden finalizada con éxito', 'green', 2000);
      //   } else if ((origen == 'Ordenes Pendientes') && (destino == 'Ordenes Eliminadas')) {
      //     this.toastService.toastMessage('Orden eliminada con éxito', 'green', 2000);
      //   } else if ((origen == 'Ordenes Finalizadas') && (destino == 'Ordenes Pendientes')) {
      //     this.toastService.toastMessage('Orden regresada a pendientes con éxito', 'green', 2000);
      //   } else if ((origen == 'Orden Finalizadas') && (destino == 'Ordenes Eliminadas')) {
      //     this.toastService.toastMessage('Orden eliminado con éxito', 'green', 2000);
      //   } else if ((origen == 'Ordenes Eliminadas') && (destino == 'Ordenes Pendientes')) {
      //     this.toastService.toastMessage('Orden regresado a pendientes con éxito', 'green', 2000);
      //   }
      // })
  }

  openConfirmDialog(id: string, tabla: string) {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        message: `¿Está seguro que desea eliminar esta órden?`,
        confirmAction: () => this.eliminarConArticulos(id, tabla) // Acción a ejecutar si se confirma
      }
    });
  }

  // =====================================================
  // ARTÍCULOS DE STOCK USADOS EN LA REPARACIÓN
  // =====================================================

  cantidadArticulos(orden: any): number {
    return articulosActivos(orden).length;
  }

  abrirArticulos(orden: any, coleccion: string) {
    this.dialog.open(ArticulosOrdenComponent, {
      width: '90vw',
      maxWidth: '820px',
      maxHeight: '90vh',
      data: { orden, coleccion }
    });
  }

  /**
   * Eliminar una orden: si tiene artículos de stock cargados, pregunta si se devuelven al stock
   * (sí → error de carga / no se usaron; no → se usaron igual).
   */
  private async eliminarConArticulos(id: string, tabla: string) {
    const lista: any[] = tabla === 'Ordenes Pendientes' ? this.ordenesPendientes
      : tabla === 'Ordenes Finalizadas' ? this.ordenesFinalizadas : [];
    const orden = lista.find(o => o.id === id);
    const activos = orden ? articulosActivos(orden) : [];

    if (activos.length && tabla !== 'Ordenes Eliminadas') {
      const detalle = activos.map(a => `<li>${a.cantidad} x ${this.escapar(a.nombre)}</li>`).join('');
      const r = await Swal.fire({
        title: '¿Devolver los artículos al stock?',
        html: `La orden #${orden.numeroOrden} tiene artículos cargados:<ul style="text-align:left">${detalle}</ul>` +
          '<small>Devolvelos si se cargaron por error o no se usaron. Si se usaron igual, no los devuelvas.</small>',
        icon: 'question',
        showDenyButton: true,
        showCancelButton: true,
        confirmButtonText: 'Sí, devolver al stock',
        denyButtonText: 'No, se usaron',
        cancelButtonText: 'Cancelar eliminación'
      });
      if (r.isDismissed) return;
      if (r.isConfirmed) {
        try {
          const res = await this.articulosOrden.devolverVarios(
            { id, coleccion: tabla, numeroOrden: orden.numeroOrden }, null, 'Orden eliminada');
          if (res.sinProducto.length) {
            await Swal.fire('Atención', `No se pudo reponer stock de: ${res.sinProducto.join(', ')} (el producto ya no existe).`, 'info');
          }
        } catch (e: any) {
          await Swal.fire('No se eliminó la orden', 'No se pudieron devolver los artículos al stock. ' + (e?.message || ''), 'error');
          return;
        }
      }
    }
    this.moverDocumento(id, tabla, 'Ordenes Eliminadas');
  }

  private escapar(t: any): string {
    return String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as any)[c]);
  }

  // =====================================================
  // PAGOS (los cobros se registran desde Despacho → Cobrar reparación)
  // =====================================================

  pagado(orden: any): number {
    return (orden?.cobros || [])
      .filter((c: any) => !c.anulado)
      .reduce((acc: number, c: any) => acc + (Number(c.monto) || 0), 0);
  }

  saldo(orden: any): number {
    return Math.max(0, Math.round(((Number(orden?.presupuesto) || 0) - this.pagado(orden)) * 100) / 100);
  }

  etiquetaPago(orden: any): string {
    if (this.pagado(orden) <= 0) return 'Sin pagos';
    return this.saldo(orden) > 0 ? 'Seña' : 'Pagada';
  }

  clasePago(orden: any): string {
    if (this.pagado(orden) <= 0) return 'bg-secondary';
    return this.saldo(orden) > 0 ? 'bg-warning text-dark' : 'bg-success';
  }

  obtenerEstadoGarantia(orden: Orden): string {

    // No posee garantía
    if (!orden.garantia) {
      return 'Sin garantía';
    }

    // Si falta información asumimos que la garantía venció
    if (!orden.fechaEntrega || !orden.diasGarantia) {
      return 'Garantía vencida';
    }

    const fechaEntrega = new Date(
      (orden.fechaEntrega as any).seconds * 1000
    );

    const fechaVencimiento = new Date(fechaEntrega);

    fechaVencimiento.setDate(
      fechaVencimiento.getDate() + orden.diasGarantia
    );

    const hoy = new Date();

    return hoy <= fechaVencimiento
      ? 'En garantía'
      : 'Garantía vencida';
  }

  obtenerClaseGarantia(orden: Orden): string {

    if (!orden.garantia) {
      return 'sin-garantia';
    }

    if (!orden.fechaEntrega || !orden.diasGarantia) {
      return 'garantia-vencida';
    }

    const fechaEntrega = new Date(
      (orden.fechaEntrega as any).seconds * 1000
    );

    const fechaVencimiento = new Date(fechaEntrega);

    fechaVencimiento.setDate(
      fechaVencimiento.getDate() + orden.diasGarantia
    );

    const hoy = new Date();

    return hoy <= fechaVencimiento
      ? 'en-garantia'
      : 'garantia-vencida';
  }


}


