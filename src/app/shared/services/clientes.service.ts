import { inject, Injectable } from '@angular/core';
import { collection, doc, Firestore, getDoc, updateDoc } from '@angular/fire/firestore';
import { from, map, Observable } from 'rxjs';
import { Cliente } from 'src/app/modules/auth/models/cliente.model';

@Injectable({
  providedIn: 'root'
})
export class ClientesService {
private firestore = inject(Firestore);
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

   actualizarCliente(id: string, datosParciales: Partial<Cliente>): Promise<void> {
    const clienteDocRef = doc(this.firestore, 'Clientes', id);
    const datosPlano = JSON.parse(JSON.stringify(datosParciales)); // 🔧 conversión segura
    return updateDoc(clienteDocRef, datosPlano);
  }
}
