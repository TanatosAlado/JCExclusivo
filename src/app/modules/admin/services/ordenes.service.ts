import { Injectable } from '@angular/core';
import {
  Firestore,
  collection,
  addDoc,
  doc,
  updateDoc,
  getDocs,
  collectionData,
  query,
  where,
  Timestamp
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

  async buscarOrdenPorCampo(campo: string, valor: string) {
    try {
      const colRef = collection(this.firestore, 'Ordenes Pendientes');
      const q = query(colRef, where(campo, '==', valor.trim()));

      const snapshot = await getDocs(q);

      if (snapshot.empty) {
        console.log('No se encontraron documentos');
        return [];
      }

      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
    } catch (error) {
      console.error('Error buscando orden:', error);
      return [];
    }
  }

  
async buscarOrdenPorNumeroYDni(numeroOrden: number, dniCliente: number) {
    try {
      const ordenesRef = collection(this.firestore, 'Ordenes Pendientes');
      const q = query(
        ordenesRef,
        where('numeroOrden', '==', numeroOrden),
        where('dniCliente', '==', dniCliente)
      );

      const querySnapshot = await getDocs(q);

      if (querySnapshot.empty) {
        return null; // No se encontró nada
      }

      let orden: any = null;
      querySnapshot.forEach((doc) => {
        const data = doc.data();

        // Convertir fechas Firebase Timestamp a Date
        ['fechaIngreso', 'fechaEntrega', 'fechaGarantia'].forEach(campo => {
          if (data[campo] instanceof Timestamp) {
            data[campo] = data[campo].toDate();
          }
        });

        orden = { id: doc.id, ...data };
      });

      return orden;

    } catch (error) {
      console.error('Error buscando orden:', error);
      throw error;
    }
  }

}
