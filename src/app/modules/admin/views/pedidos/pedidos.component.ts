import { ChangeDetectorRef, Component, ViewChild } from '@angular/core';
import { doc, Firestore, updateDoc } from '@angular/fire/firestore';
import { MatDialog } from '@angular/material/dialog';
import { MatPaginator } from '@angular/material/paginator';
import { MatTableDataSource } from '@angular/material/table';
import { Pedido } from 'src/app/modules/shop/models/pedido.model';
import { ConfirmDialogComponent } from 'src/app/shared/components/confirm-dialog/confirm-dialog.component';
import { PedidosService } from 'src/app/shared/services/pedidos.service';
import { ToastService } from 'src/app/shared/services/toast.service';
import { MatTabChangeEvent } from '@angular/material/tabs';

@Component({
  selector: 'app-pedidos',
  templateUrl: './pedidos.component.html',
  styleUrls: ['./pedidos.component.css']
})
export class PedidosComponent {
showTablaPedido: boolean = true;
  activeTab: number = 1;
  datasourcePedidosPendientes: MatTableDataSource<Pedido>
  datasourcePedidosFinalizados: MatTableDataSource<Pedido>
  datasourcePedidosEliminados: MatTableDataSource<Pedido>
  pedidoEncontrado: any = null;
  pedidosPendientes: Pedido[] = []
  pedidosFinalizados: Pedido[] = []
  pedidosEliminados: Pedido[] = []
  showCarroPedido: boolean = false
  showFormPedido: Boolean = false
  showDeleteCarro: boolean = true
  columnsProductos: string[] = ['imagen', 'marca', 'nombre', 'rubro', 'subRubro', 'precio', 'acciones']
  columnsClientes: string[] = ['apellido', 'dni', 'mail', 'celular', 'direccion', 'acciones']
  columnsPedidosPendietes: string[] = ['numero', 'hora', 'usuario', 'celular', 'direccion', 'entrega', 'pago', 'total', 'acciones']
  columnsPedidosFinalizados: string[] = ['numero', 'hora', 'usuario', 'celular', 'direccion', 'entrega', 'pago', 'total', 'acciones']
  columnsPedidosEliminados: string[] = ['numero', 'hora', 'usuario', 'celular', 'direccion', 'entrega', 'pago', 'total', 'acciones']
  mostrarModalImpresion: boolean = false;
  paginator!: MatPaginator;
  showFormAgregarProducto: boolean = false
  showTablaVerProducto: boolean = false
  showFormAgregarCliente: boolean = false
  showTablaVerCliente: boolean = false

  @ViewChild('paginatorPendientes') paginatorPendientes!: MatPaginator;
  @ViewChild('paginatorFinalizados') paginatorFinalizados!: MatPaginator;
  @ViewChild('paginatorEliminados') paginatorEliminados!: MatPaginator;



  constructor(private pedidosService: PedidosService, private toastService: ToastService, private cdRef: ChangeDetectorRef, private dialog: MatDialog, private firestore: Firestore) {

    this.datasourcePedidosPendientes = new MatTableDataSource(this.pedidosPendientes);
    this.datasourcePedidosFinalizados = new MatTableDataSource(this.pedidosFinalizados);
    this.datasourcePedidosEliminados = new MatTableDataSource(this.pedidosEliminados);
    }


  
  ngOnInit() {
    this.getPedidos()
  }


  @ViewChild(MatPaginator) set matPaginator(mp: MatPaginator) {
    if (mp) {
      this.paginator = mp;
      this.paginator._intl.itemsPerPageLabel = 'Pedidos por Página';
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
    if (this.datasourcePedidosPendientes && this.activeTab===1) {
      this.datasourcePedidosPendientes.paginator = this.paginator;
    }

    if (this.datasourcePedidosFinalizados&& this.activeTab===2) {
      this.datasourcePedidosFinalizados.paginator = this.paginator;
    }
     if (this.datasourcePedidosEliminados&& this.activeTab===3) {
      this.datasourcePedidosEliminados.paginator = this.paginator;
    }
  }



  applyFilter(event: Event, datasource: MatTableDataSource<any>) {
    const filterValue = (event.target as HTMLInputElement).value;
    datasource.filter = filterValue.trim().toLowerCase();
  }

  //FUNCION PARA MOSTRAR LA TABLA CON EL PEDIDO DEL CLIENTE
  showCarritoPedidoPendiente(id: any) {
    this.pedidoEncontrado = this.pedidosPendientes.find(p => p.id === id);
    this.showTablaPedido = false
    this.showCarroPedido = true
    this.showFormPedido = true
    this.showDeleteCarro = true
    this.activeTab = 1
  }

  //FUNCION PARA MOSTRAR LA TABLA CON EL PEDIDO DEL CLIENTE
  showCarritoPedidoFinalizado(id: any) {
    this.pedidoEncontrado = this.pedidosFinalizados.find(p => p.id === id);
    this.showTablaPedido = false
    this.showCarroPedido = true
    this.showFormPedido = true
    this.showDeleteCarro = false
    this.activeTab = 2
  }

  setPaginator(tab:number){
   this.activeTab = tab;
  this.setDataSourceAttributes();

  }

  //FUNCION PARA MOSTRAR LA TABLA CON EL PEDIDO DEL CLIENTE
  showCarritoPedidoEliminado(id: any) {
    this.pedidoEncontrado = this.pedidosEliminados.find(p => p.id === id);

    this.showTablaPedido = false
    this.showCarroPedido = true
    this.showFormPedido = true
    this.showDeleteCarro = false
    this.activeTab = 3
  }

  //FUNCION PARA ELIMINAR UN PEDIDO ESPECIFICO
  deletePedido(id: string, tabla: string) {
    this.pedidosService.deletePedidoById(id, tabla)
  }

  openConfirmDialog(id: string, tabla: string) {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        message: `¿Está seguro que desea eliminar este pedido?`,
        confirmAction: () => this.moverDocumento(id, tabla, 'Pedidos Eliminados') // Acción a ejecutar si se confirma
      }
    });
  }

  openConfirmDialogDel(id: string, tabla: string) {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        message: `¿Está seguro que desea eliminar este pedido?`,
        confirmAction: () => this.deletePedido(id, 'Pedidos Eliminados') // Acción a ejecutar si se confirma
      }
    });
  }

  getPedidos() {
    this.pedidosService.getPedidosPorTipo('Pedidos Pendientes').subscribe(data => {
      this.pedidosPendientes = data.sort((a, b) => b.nroPedido - a.nroPedido);
      this.datasourcePedidosPendientes = new MatTableDataSource(this.pedidosPendientes);
      this.datasourcePedidosPendientes.paginator = this.paginatorPendientes;
      this.cdRef.detectChanges();
    });

    this.pedidosService.getPedidosPorTipo('Pedidos Finalizados').subscribe(data => {
      this.pedidosFinalizados = data.sort((a, b) => b.nroPedido - a.nroPedido);
      this.datasourcePedidosFinalizados = new MatTableDataSource(this.pedidosFinalizados);
      this.datasourcePedidosFinalizados.paginator = this.paginatorFinalizados;
      this.cdRef.detectChanges();
    });

    this.pedidosService.getPedidosPorTipo('Pedidos Eliminados').subscribe(data => {
      this.pedidosEliminados = data.sort((a, b) => b.nroPedido - a.nroPedido);
      this.datasourcePedidosEliminados = new MatTableDataSource(this.pedidosEliminados);
      this.datasourcePedidosEliminados.paginator = this.paginatorEliminados;
      this.cdRef.detectChanges();
    });
  }


  showBodyProductos() {
    this.showFormAgregarProducto = false
    this.showTablaVerProducto = true
    this.showFormAgregarCliente = false
    this.showTablaVerCliente = false
  }

  activarEdicion(carro: any) {
    carro.editandoCantidad = true;
  }

  //FUNCION PARA DESHABILITAR EL INPUT PARA CAMBIAR CANTIDAD DE PRODUCTOS
  desactivarEdicion(carro: any) {
    carro.editandoCantidad = false;
    this.actualizarTotal();
    this.updatePedidoCarrito()

  }

  actualizarTotal() {
    if (!this.pedidoEncontrado || !this.pedidoEncontrado.carrito) return;

    let nuevoTotal = 0;
    for (let item of this.pedidoEncontrado.carrito) {
      nuevoTotal += item.precioFinal * item.cantidad;
    }

    this.pedidoEncontrado.total = nuevoTotal;
  }

  //FUNCION PARA ACTUALIZAR EL PEDIDO DEL CARRO EN ADMIN
  updatePedidoCarrito() {
    // Actualizar en Firestore
    this.pedidosService.updateCarroEnPedido(this.pedidoEncontrado.id, this.pedidoEncontrado.carrito)
      .then(() => {
      })
      .catch(err => {
      });
  }

  // FUNCION PARA MOSTRAR LA TABLA DEL CUERPO PRODUCTO Y OCULTAR LAS DEMAS
  showBodyPedidos() {
    if (this.pedidoEncontrado?.carrito?.length) {
      this.pedidoEncontrado.carrito.forEach((carro: any) => {
        this.desactivarEdicion(carro);
      });
    }
    this.showFormAgregarProducto = false
    this.showTablaVerProducto = true
    this.showTablaPedido = true
    this.showFormPedido = false
    // this.activeTab=2
  }

  //FUNCION PARA ELIMINAR EL PEDIDO DE UN CARRITO
  eliminarProductoCarro(carro: any) {
    const idPedido = this.pedidoEncontrado.id;
    const idProducto = carro.id;

    this.pedidosService.deleteProductoDelCarrito(idPedido, idProducto)
      .then(() => {
        this.toastService.toastMessage('Producto eliminado con éxito', 'green', 2000);
        this.pedidoEncontrado.carrito = this.pedidoEncontrado.carrito.filter((p: { id: any; }) => p.id !== idProducto);
        if (this.pedidoEncontrado.carrito.length === 0) {
          this.showCarroPedido = false;
          this.toastService.toastMessage('Producto eliminado con éxito', 'green', 2000);
        } else {
          this.pedidoEncontrado.total = this.pedidoEncontrado.carrito.reduce(
            (acc: number, producto: any) => acc + producto.precioFinal * producto.cantidad, 0
          );
        }
      })
      .catch((error) => {
        console.error('Error al eliminar producto:', error);
        this.toastService.toastMessage('Producto eliminado con éxito', 'red', 2000);
      });
  }

  moverDocumento(id: string, origen: string, destino: string) {
    this.pedidosService.moverDocumento(id, origen, destino)
      .then(() => {
        if ((origen == 'Pedidos Pendientes') && (destino == 'Pedidos Finalizados')) {
          this.toastService.toastMessage('Pedido finalizado con éxito', 'green', 2000);
        } else if ((origen == 'Pedidos Pendientes') && (destino == 'Pedidos Eliminados')) {
          this.toastService.toastMessage('Pedido eliminado con éxito', 'green', 2000);
        } else if ((origen == 'Pedidos Finalizados') && (destino == 'Pedidos Pendientes')) {
          this.toastService.toastMessage('Pedido regresado a pendientes con éxito', 'green', 2000);
        } else if ((origen == 'Pedidos Finalizados') && (destino == 'Pedidos Eliminados')) {
          this.toastService.toastMessage('Pedido eliminado con éxito', 'green', 2000);
        } else if ((origen == 'Pedidos Eliminados') && (destino == 'Pedidos Pendientes')) {
          this.toastService.toastMessage('Pedido regresado a pendientes con éxito', 'green', 2000);
        }
        //this.getPedidos();
      })
  }


  onTabChange(event: MatTabChangeEvent) {
    this.cdRef.detectChanges();

    if (event.index === 0) {
      this.datasourcePedidosPendientes.paginator = this.paginatorPendientes;
    } else if (event.index === 1) {
      this.datasourcePedidosFinalizados.paginator = this.paginatorFinalizados;
    }
  }

  abrirModalImpresion() {
    this.mostrarModalImpresion = true;
  }

  cerrarModalImpresion() {
    this.mostrarModalImpresion = false;
  }

  imprimir() {
    if (this.pedidoEncontrado && this.pedidoEncontrado.id) {
      const pedidoId = this.pedidoEncontrado.id;

      const ref = doc(this.firestore, 'Pedidos Pendientes', pedidoId);

      updateDoc(ref, { estado: 'En preparación' })
        .then(() => {
          window.print();
          this.cerrarModalImpresion();
        })
        .catch(error => {
          window.print();
          this.cerrarModalImpresion();
        });
    } else {
      window.print();
      this.cerrarModalImpresion();
    }
  }
}
