import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { addDoc, collection, collectionData, deleteDoc, doc, Firestore, query, updateDoc, where } from '@angular/fire/firestore';
import { Producto } from '../models/producto.model';

@Injectable({
  providedIn: 'root'
})
export class ProductosService {

  constructor(private firestore: Firestore) { }

   obtenerProductos(): Observable<Producto[]> {
    const ref = collection(this.firestore, 'productos');
    return collectionData(ref, { idField: 'id' }) as Observable<Producto[]>;
  }

  agregarProducto(producto: Producto): Promise<any> {
    console.log('Producto a agregar:', producto);
    const ref = collection(this.firestore, 'productos');
    return addDoc(ref, producto);
  }

  editarProducto(producto: Producto): Promise<void> {
    const productoRef = doc(this.firestore, `productos/${producto.id}`);
    return updateDoc(productoRef, { ...producto });
  }

  eliminarProducto(id: string): Promise<void> {
    const docRef = doc(this.firestore, 'productos', id);
    return deleteDoc(docRef);
  }

  obtenerDestacados(): Observable<Producto[]> {
    const ref = collection(this.firestore, 'productos');
    const q = query(ref, where('destacado', '==', true));
    return collectionData(q) as Observable<Producto[]>;
  }

  actualizarProducto(producto: Producto): Promise<void> {
    console.log('Producto a actualizar:', producto);
    const docRef = doc(this.firestore, 'productos', producto.id);
    return updateDoc(docRef, { ...producto });
  }


}
