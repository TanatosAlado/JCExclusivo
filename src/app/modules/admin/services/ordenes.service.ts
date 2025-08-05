import { Injectable } from '@angular/core';
import {
  Firestore,
  collection,
  addDoc,
  doc,
  updateDoc,
  getDocs,
  collectionData
} from '@angular/fire/firestore';
import { Orden } from '../models/orden.model';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class OrdenesService {

  constructor(private firestore: Firestore) { }

    async generarNumeroOrden(): Promise<number> {
    const ref = collection(this.firestore, 'Contador Ordenes');
    const snapshot = await getDocs(ref);

    if (snapshot.empty) {
      throw new Error('No se encontró el contador de órdenes');
    }

    const docSnap = snapshot.docs[0];
    const data = docSnap.data();
    const actual = data['valor'] || 0;
    const nuevo = actual + 1;

    await updateDoc(doc(this.firestore, 'Contador Ordenes', docSnap.id), { valor: nuevo });

    return nuevo;
  }

    async crearOrden(orden: Omit<Orden, 'id'>): Promise<void> {
    const ordenesRef = collection(this.firestore, 'Ordenes Pendientes');
    const docRef = await addDoc(ordenesRef, orden);
    await updateDoc(docRef, { id: docRef.id });
  }

  obtenerOrdenes(): Observable<Orden[]> {
    const ref = collection(this.firestore, 'Ordenes Pendientes');
    return collectionData(ref, { idField: 'id' }) as Observable<Orden[]>;
  }




}
