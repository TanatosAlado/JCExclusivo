import { Injectable } from '@angular/core';
import { Firestore, collection, deleteDoc, doc,getDocs,setDoc } from '@angular/fire/firestore';
import { Marquesina } from '../models/marquesina.model';

@Injectable({
  providedIn: 'root'
})
export class MarquesinaService {

  marquesinasCache: Marquesina[] = [];

  constructor(private firestore: Firestore) {}

async agregarMarquesina(marquesina: Marquesina) {

  const ref = collection(this.firestore, 'Marquesina');

  const docRef = doc(ref);

  marquesina.id = docRef.id;

  await setDoc(docRef, marquesina);

  this.marquesinasCache.push(marquesina);

  return docRef;
}

//FUNCION PARA TRAER TODAS LAS MARQUESINAS
 async getMarquesinas(): Promise<Marquesina[]> {
    const ref = collection(this.firestore, 'Marquesina');
    const snap = await getDocs(ref);

    return snap.docs.map(doc => {
      const { id, ...rest } = doc.data() as Marquesina;
      return { id: doc.id, ...rest };
    });
  }


  async actualizarMarquesina(marquesina: Marquesina) {
    if (!marquesina.id) throw new Error('La marquesina debe tener un ID');

    const ref = doc(this.firestore, `Marquesina/${marquesina.id}`);
    return setDoc(ref, marquesina, { merge: true });
  }

    //SERVICE PARA ELIMINAR UNA MARQUESINA
  eliminarMarquesina(id: string): Promise<void> {
    const docRef = doc(this.firestore, 'Marquesina', id);
    return deleteDoc(docRef);
  }
}