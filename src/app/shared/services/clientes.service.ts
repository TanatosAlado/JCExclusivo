import { inject, Injectable } from '@angular/core';
import { collection, collectionData, CollectionReference, deleteDoc, doc, Firestore, getDoc, getDocs, query, updateDoc, where } from '@angular/fire/firestore';
import { BehaviorSubject, from, map, Observable, shareReplay, tap } from 'rxjs';
import { Cliente } from 'src/app/modules/auth/models/cliente.model';

@Injectable({
  providedIn: 'root'
})
export class ClientesService {
private firestore = inject(Firestore);
  clientesSubject = new BehaviorSubject<Cliente[]>([]);
  clientes$ = this.clientesSubject.asObservable();
  private cliente$: Observable<Cliente[]> | null = null;

  constructor() { }


    getClienteById(id: string): Observable<Cliente> {
    const clientesRef = collection(this.firestore, 'Clientes');
    const clienteDocRef = doc(clientesRef, id);
    return from(getDoc(clienteDocRef)).pipe(
      map(snapshot => {
        const data = snapshot.data();
        if (!data) {
          throw new Error('Cliente no encontrado');
        }

        return {
          id: snapshot.id,
          ...data
        } as Cliente;
      })
    );
  }

  getClientes(): Observable<Cliente[]> {
    if (!this.cliente$) {
      const ref = collection(this.firestore, 'Clientes') as CollectionReference<Cliente>;
      this.cliente$ = collectionData(ref, { idField: 'id' }).pipe(
        tap(clientes => console.log('')),
        shareReplay(1)
      );
    } else {
    }
    return this.cliente$;
  }

  actualizarCliente(id: string, datosParciales: Partial<Cliente>): Promise<void> {
    const clienteDocRef = doc(this.firestore, 'Clientes', id);
    const datosPlano = JSON.parse(JSON.stringify(datosParciales)); // 🔧 conversión segura
    return updateDoc(clienteDocRef, datosPlano);
  }

  eliminarCliente(id: string): Promise<void> {
    const ref = doc(this.firestore, 'Clientes', id);
    return deleteDoc(ref);
  }

  async buscarPorDni(dni: number): Promise<Cliente | null> {
    const clientesRef = collection(this.firestore, 'Clientes');
    const q = query(clientesRef, where('dni', '==', dni));
    const snapshot = await getDocs(q);

    if (!snapshot.empty) {
      const doc = snapshot.docs[0];
      return { id: doc.id, ...doc.data() } as Cliente;
    } else {
      return null;
    }
  }

  async buscarPorDocumento(doc: number): Promise<Cliente | null> {
    const clientesRef = collection(this.firestore, 'Clientes');

    // 🔥 1. Buscar como NUMBER en DNI
    let q = query(clientesRef, where('dni', '==', doc));
    let snapshot = await getDocs(q);

    if (!snapshot.empty) {
      const d = snapshot.docs[0];
      return { id: d.id, ...d.data() } as Cliente;
    }

    // 🔥 2. Buscar como STRING en DNI (compatibilidad datos viejos)
    q = query(clientesRef, where('dni', '==', doc.toString()));
    snapshot = await getDocs(q);

    if (!snapshot.empty) {
      const d = snapshot.docs[0];
      return { id: d.id, ...d.data() } as Cliente;
    }

    // 🔥 3. Buscar como NUMBER en CUIT
    q = query(clientesRef, where('cuit', '==', doc));
    snapshot = await getDocs(q);

    if (!snapshot.empty) {
      const d = snapshot.docs[0];
      return { id: d.id, ...d.data() } as Cliente;
    }

    // 🔥 4. Buscar como STRING en CUIT
    q = query(clientesRef, where('cuit', '==', doc.toString()));
    snapshot = await getDocs(q);

    if (!snapshot.empty) {
      const d = snapshot.docs[0];
      return { id: d.id, ...d.data() } as Cliente;
    }

    return null;
  }

}
