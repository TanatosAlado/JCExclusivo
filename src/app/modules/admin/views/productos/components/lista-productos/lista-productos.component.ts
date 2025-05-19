import { Component } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { AltaProductoComponent } from '../alta-producto/alta-producto.component';
import { ProductosService } from 'src/app/modules/shop/services/productos.service';
import { Producto } from 'src/app/modules/shop/models/producto.model';

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

  constructor(public dialog: MatDialog, private productosService: ProductosService,){

  }

  ngOnInit(): void {
    this.obtenerProductos();
  }

    obtenerProductos(): void {
    this.productosService.obtenerProductos().subscribe((productos: Producto[]) => {
      this.productos = productos;
      console.log('Productos:', this.productos);
      this.rubrosUnicos = [...new Set(productos.map(p => p.rubro.toUpperCase()))];
      this.subrubrosUnicos = [...new Set(productos.map(p => p.subrubro.toUpperCase()))];
      this.marcasUnicas = [...new Set(productos.map(p => p.marca.toUpperCase()))];
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

  }

    verProducto(producto: any): void {

  }

  eliminarProducto(id: string): void {

  }

    openConfirmDialog(producto: any): void {

  }

}
