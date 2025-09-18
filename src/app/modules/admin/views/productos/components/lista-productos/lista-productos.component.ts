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
import * as XLSX from 'xlsx';

@Component({
  selector: 'app-lista-productos',
  templateUrl: './lista-productos.component.html',
  styleUrls: ['./lista-productos.component.css']
})
export class ListaProductosComponent {

  rubrosUnicos: string[] = [];
  subrubrosUnicos: string[] = [];
  marcasUnicas: string[] = [];
  displayedColumns: string[] = ['descripcion', 'rubro', 'stock', 'precioMinorista', 'precioMayorista', 'acciones'];

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



// Inicio Carga Excel

onFileChange(event: any) {
  const target: DataTransfer = <DataTransfer>(event.target);
  if (target.files.length !== 1) {
    console.error('Debe cargar un único archivo Excel');
    return;
  }

  const reader: FileReader = new FileReader();
  reader.onload = (e: any) => {
    const bstr: string = e.target.result;
    const wb: XLSX.WorkBook = XLSX.read(bstr, { type: 'binary' });

    // tomo la primera hoja
    const wsname: string = wb.SheetNames[0];
    const ws: XLSX.WorkSheet = wb.Sheets[wsname];

    // convierto a JSON
    const data: any[] = XLSX.utils.sheet_to_json(ws, { header: 1 });

    // la primera fila son los headers → usamos sheet_to_json sin header:1
    const productosExcel: any[] = XLSX.utils.sheet_to_json(ws);

    console.log('Productos importados desde Excel:', productosExcel);

    // mapear cada fila a Producto
    productosExcel.forEach((v: any) => {
const producto = new Producto(
  v.id,
  v.codigoBarras,
  v.descripcion,
  v.precioCosto,
  v.ventaMinorista,
  v.precioMinorista,
  v.ventaMayorista,
  v.precioMayorista,
  v.imagen,
  v.rubro,
  v.subrubro,
  v.marca,
  v.destacado,
  v.oferta,
  v.precioOferta,
  v.precioSinImpuestos,
  v.stockMinimo,
  v.stockSucursales || []
);

      // lógica de checks (igual que formulario)
      if (!producto.ventaMinorista) producto.precioMinorista = 0;
      if (!producto.ventaMayorista) producto.precioMayorista = 0;
      if (!producto.oferta) producto.precioOferta = 0;

      // Guardamos en Firebase
      this.productosService.agregarProducto(producto)
        .then((docRef) => {
          producto.id = docRef.id;
          return this.productosService.actualizarProducto(producto);
        })
        .then(() => console.log('Producto importado:', producto));
    });
  };
  reader.readAsBinaryString(target.files[0]);
}

// helper para convertir TRUE/FALSE/1/0
private parseBoolean(value: any): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  if (typeof value === 'number') return value === 1;
  return false;
}

private parseNumber(value: any): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    // elimina símbolos de moneda, comas, espacios
    const clean = value.replace(/[^0-9.,-]/g, '').replace(',', '.');
    return Number(clean) || 0;
  }
  return 0;
}

// Fin Carga Excel






}
