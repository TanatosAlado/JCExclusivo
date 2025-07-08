import { Injectable } from '@angular/core';
import { collection, doc, Firestore, getDocs, updateDoc } from '@angular/fire/firestore';
import { BehaviorSubject } from 'rxjs';
import { Contador } from 'src/app/modules/shop/models/contador.model';

@Injectable({
  providedIn: 'root'
})
export class ContadorService {

contadorSubject = new BehaviorSubject<Contador[]>([]);
    contador$ = this.contadorSubject.asObservable();

  constructor(private firestore:Firestore) { }


 // SERVICE PARA TRAER EL CONTADOR DE PEDIDOS
  getContador(): Promise<void> {
    const contadorRef = collection(this.firestore, 'Contador Pedidos');
    return getDocs(contadorRef).then(snapshot => {
      const contador: Contador[] = snapshot.docs.map(doc => ({
        ...doc.data() as Contador,
        id: doc.id
      }));
      this.contadorSubject.next(contador);
    }).catch(error => {
      console.error('Error al obtener contador:', error);
    });
  }

  //SERVICE PARA ACTUALIZAR CONTADOR DE PEDIDOS
    updateContador(id: string, contador: any) {
      const contadorRef = doc(this.firestore, 'Contador Pedidos', id);
      return updateDoc(contadorRef, contador);
    }

}
