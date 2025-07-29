import { Component, ViewChild } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { AltaProductoComponent } from '../alta-producto/alta-producto.component';
import { ProductosService } from 'src/app/modules/shop/services/productos.service';
import { Producto } from 'src/app/modules/shop/models/producto.model';
import { MatTableDataSource } from '@angular/material/table';
import { MatPaginator } from '@angular/material/paginator';
import { EdicionProductoComponent } from '../edicion-producto/edicion-producto.component';
import { ConfirmDialogComponent } from 'src/app/shared/components/confirm-dialog/confirm-dialog.component';
import { DetalleProductoComponent } from '../detalle-producto/detalle-producto.component';
import { ToastService } from 'src/app/shared/services/toast.service';

@Component({
  selector: 'app-lista-productos',
  templateUrl: './lista-productos.component.html',
  styleUrls: ['./lista-productos.component.css']
})
export class ListaProductosComponent {

  rubrosUnicos: string[] = [];
  subrubrosUnicos: string[] = [];
  marcasUnicas: string[] = [];
  displayedColumns: string[] = ['nombre', 'descripcion', 'acciones'];
  productos: Producto[] = [];
  datasourceProductos: MatTableDataSource<Producto>
  paginator!: MatPaginator;
  public productoAEliminar: string = ''; 

  constructor(public dialog: MatDialog, private productosService: ProductosService,private toastService:ToastService){

  }

  ngOnInit(): void {
    this.obtenerProductos();
  }

     ngAfterViewInit() {
    this.setDataSourceAttributes()
  }

   @ViewChild(MatPaginator) set matPaginator(mp: MatPaginator) {
      if (mp) {
        this.paginator = mp;
        this.paginator._intl.itemsPerPageLabel = 'Productos por Página';
        this.paginator._intl.firstPageLabel = 'Primera Página';
        this.paginator._intl.previousPageLabel = 'Página Anterior';
        this.paginator._intl.nextPageLabel = 'Siguiente Página';
        this.paginator._intl.lastPageLabel = 'Última Página';
      }
      this.setDataSourceAttributes();
    }

  setDataSourceAttributes() {
    if (this.datasourceProductos) {
      this.datasourceProductos.paginator = this.paginator;
    }
  }
  obte

       //FUNCION PARA FILTRAR POR CUALQUIER PALABRA QUE SE ESCRIBA EN EL FILTRO
  applyFilter(event: Event, datasource: MatTableDataSource<any>) {
    const filterValue = (event.target as HTMLInputElement).value;
    datasource.filter = filterValue.trim().toLowerCase();
  }

    obtenerProductos(): void {
    this.productosService.obtenerProductos().subscribe((productos: Producto[]) => {
      this.productos = productos;
      console.log('Productos:', this.productos);
      this.rubrosUnicos = [...new Set(productos.map(p => p.rubro.toUpperCase()))];
      this.subrubrosUnicos = [...new Set(productos.map(p => p.subrubro.toUpperCase()))];
      this.marcasUnicas = [...new Set(productos.map(p => p.marca.toUpperCase()))];
      this.datasourceProductos = new MatTableDataSource(this.productos);
      this.datasourceProductos.paginator = this.paginator;
    });
  }

  abrirModalAltaProducto(): void {
  const dialogRef = this.dialog.open(AltaProductoComponent, {
    width: '90vw',
    maxWidth: '600px',
    height: 'auto',
    maxHeight: '90vh',
    panelClass: 'custom-dialog-container',
    data: {
      rubros: this.rubrosUnicos,
      subrubros: this.subrubrosUnicos,
      marcas: this.marcasUnicas
    }
  });

  dialogRef.afterClosed().subscribe(resultado => {
    if (resultado) {
      console.log('Producto creado:', resultado);
   //   this.obtenerProductos(); // Refrescar productos
    }
  });
}

editarProducto(producto: Producto): void {
    const dialogRef = this.dialog.open(EdicionProductoComponent, {
      width: '600px',
      data: producto,  // Enviar los datos del producto a editar
    });

    dialogRef.afterClosed().subscribe((resultado) => {
      if (resultado) {
        this.productosService.actualizarProducto(resultado)
        .then(() => {
          this.obtenerProductos(); // Refrescar la lista después de cerrar el modal
        })
        .catch(error => {
        });
      }
    });
  }

     verProducto(producto: any): void {
    this.dialog.open(DetalleProductoComponent, {
      width: '500px',
      data: producto
    });
  }

 eliminarProducto(id: string): void {
    this.productosService.eliminarProducto(id).then(() => {
     this.toastService.toastMessage('Producto eliminado con éxito', 'green', 2000);
    })
  }

    openConfirmDialog(producto: any): void {
    this.productoAEliminar = producto.id;
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        message: `¿Está seguro que desea eliminar este producto: ${producto.nombre}?`,
        confirmAction: () => this.eliminarProducto(producto.id) // Acción a ejecutar si se confirma
      }
    });
  }

}
