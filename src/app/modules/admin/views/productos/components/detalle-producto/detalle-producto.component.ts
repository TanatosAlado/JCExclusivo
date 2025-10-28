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

  constructor(
    @Inject(MAT_DIALOG_DATA) public producto: any,
    private firestore: Firestore
  ) {}

  ngOnInit() {
    this.cargarSucursales();
  }

  cargarSucursales() {
    const colRef = collection(this.firestore, 'Sucursales');
    collectionData(colRef, { idField: 'id' }).subscribe((data) => {
      this.sucursales = data;
    });
  }

  obtenerNombreSucursal(id: string): string {
    return this.sucursales.find(s => s.id === id)?.nombre || id;
  }

  // ✅ Calcula el stock total de una variante
  getStockTotalVariante(variante: any): number {
    if (!variante?.stockSucursales) return 0;
    return variante.stockSucursales.reduce((acc, s) => acc + s.cantidad, 0);
  }

  getStockTotal(producto: any): number {
    const stockSuc = (producto.stockSucursales || []).reduce((a: number, b: any) => a + (b.cantidad || 0), 0);
    return stockSuc;
  }

}
