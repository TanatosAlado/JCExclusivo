import { Component, Inject, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';
import { Firestore, collection, collectionData } from '@angular/fire/firestore';
import { Observable } from 'rxjs';

@Component({
  selector: 'app-detalle-producto',
  templateUrl: './detalle-producto.component.html',
  styleUrls: ['./detalle-producto.component.css']
})
export class DetalleProductoComponent {

  sucursales: any[] = [];

  constructor(@Inject(MAT_DIALOG_DATA) public producto: any, private firestore: Firestore,) { }

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

}
