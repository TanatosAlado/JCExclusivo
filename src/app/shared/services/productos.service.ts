import { Injectable } from '@angular/core';
import { collection, collectionData, Firestore } from '@angular/fire/firestore';
import { map, Observable, shareReplay, tap } from 'rxjs';
import { Producto } from 'src/app/modules/shop/models/producto.model';
import { CollectionReference } from 'firebase/firestore';

@Injectable({
  providedIn: 'root'
})
export class ProductosService {

  private productos$: Observable<Producto[]> | null = null;

  constructor(private firestore: Firestore) { }


  //SERVICIO PARA TRAER TODOS LOS PRODUCTOS 
  getProductos(): Observable<Producto[]> {
    if (!this.productos$) {
      const ref = collection(this.firestore, 'productos') as CollectionReference<Producto>;
      this.productos$ = collectionData(ref, { idField: 'id' }).pipe(
        tap(productos => console.log('')),
        shareReplay(1)
      );
    } else {
    }
    return this.productos$;
  }

  //SERVICIO PARA BUSCAR UN PRODUCTO POR NOMBRE
  getProductoByNombre(nombre: string): Observable<Producto[]> {
    return this.getProductos().pipe(
      map(productos =>
        productos.filter(p =>
          p.nombre.toLowerCase().includes(nombre.toLowerCase())
        )
      )
    );
  }
}
