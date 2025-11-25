import { Component, Inject, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';
import { Firestore, collection, collectionData } from '@angular/fire/firestore';

@Component({
  selector: 'app-detalle-producto',
  templateUrl: './detalle-producto.component.html',
  styleUrls: ['./detalle-producto.component.css']
})
export class DetalleProductoComponent implements OnInit {

  sucursales: any[] = [];
  stockTotal: number = 0;


  constructor(
    @Inject(MAT_DIALOG_DATA) public producto: any,
    private firestore: Firestore
  ) {}

ngOnInit() {
  this.normalizarStock(this.producto);
  this.stockTotal = this.getStockTotal(this.producto);
  this.cargarSucursales();
}


normalizarStock(producto: any) {

  // 👉 Normalizar stockSucursales del producto
  if (producto.stockSucursales && !Array.isArray(producto.stockSucursales)) {
    producto.stockSucursales = Object.keys(producto.stockSucursales).map(key => ({
      sucursalId: key,
      cantidad: producto.stockSucursales[key] || 0
    }));
  }

  // 👉 Si tiene variantes, normalizarlas también
  if (producto.variantes) {
    producto.variantes = producto.variantes.map((v: any) => {

      if (v.stockSucursales && !Array.isArray(v.stockSucursales)) {
        v.stockSucursales = Object.keys(v.stockSucursales).map(key => ({
          sucursalId: key,
          cantidad: v.stockSucursales[key] || 0
        }));
      }

      return v;
    });
  }
}

  cargarSucursales() {
    const colRef = collection(this.firestore, 'Sucursales');
    collectionData(colRef, { idField: 'id' }).subscribe(data => {
      this.sucursales = data;
    });
  }

  obtenerNombreSucursal(id: string): string {
    return this.sucursales.find(s => s.id === id)?.nombre || id;
  }

getStockTotal(producto: any): number {
  return (producto.stockSucursales || [])
    .reduce((a: number, s: any) => a + (s.cantidad || 0), 0);
}


}
