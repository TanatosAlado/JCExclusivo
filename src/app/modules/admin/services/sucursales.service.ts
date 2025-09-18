import { Injectable } from '@angular/core';
import { Firestore, collection, addDoc, updateDoc, deleteDoc, doc, collectionData, DocumentReference } from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { Sucursal } from '../models/sucursal.model';

@Injectable({
  providedIn: 'root'
})
export class SucursalesService {

  private sucursalesCollection = collection(this.firestore, 'Sucursales');

  constructor(private firestore: Firestore) {}

  // Obtener todas las sucursales
  obtenerSucursales(): Observable<Sucursal[]> {
    return collectionData(this.sucursalesCollection, { idField: 'id' }) as Observable<Sucursal[]>;
  }

  // Crear una nueva sucursal
  async agregarSucursal(sucursal: Sucursal): Promise<DocumentReference> {
    return await addDoc(this.sucursalesCollection, sucursal);
  }

  // Actualizar sucursal existente
  async actualizarSucursal(id: string, sucursal: Partial<Sucursal>): Promise<void> {
    const docRef = doc(this.firestore, `Sucursales/${id}`);
    await updateDoc(docRef, sucursal);
  }

  // Eliminar sucursal
  async eliminarSucursal(id: string): Promise<void> {
    const docRef = doc(this.firestore, `Sucursales/${id}`);
    await deleteDoc(docRef);
  }
}