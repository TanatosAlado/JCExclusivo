import { Injectable } from '@angular/core';
import { Firestore, collection, deleteDoc, doc,getDocs,query,setDoc, where } from '@angular/fire/firestore';
import { Marquesina } from '../models/marquesina.model';
import { AuditoriaService } from 'src/app/shared/services/auditoria.service';

@Injectable({
  providedIn: 'root'
})
export class MarquesinaService {

  marquesinasCache: Marquesina[] = [];

  constructor(private firestore: Firestore, private auditoria: AuditoriaService) {}

async agregarMarquesina(marquesina: Marquesina) {

  const ref = collection(this.firestore, 'Marquesina');

  const docRef = doc(ref);

  marquesina.id = docRef.id;

  await setDoc(docRef, marquesina);

  this.marquesinasCache.push(marquesina);

  this.auditoria.registrar({
    accion: 'crear', entidad: 'Marquesina', entidadId: docRef.id,
    descripcion: `Creó un mensaje de marquesina: "${marquesina.mensaje}"`, despues: marquesina
  });

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

  // TRAER MARQUESINAS SEGÚN TIPO DE CLIENTE
async getMarquesinasPorTipo(tipoCliente: string): Promise<Marquesina[]> {

  const ref = collection(this.firestore, 'Marquesina');

  const q = query(
    ref,
    where('tipoCliente', '==', tipoCliente)
  );

  const snap = await getDocs(q);

  return snap.docs.map(doc => {
    const { id, ...rest } = doc.data() as Marquesina;

    return {
      id: doc.id,
      ...rest
    };
  });
}


  async actualizarMarquesina(marquesina: Marquesina) {
    if (!marquesina.id) throw new Error('La marquesina debe tener un ID');

    const antes = await this.auditoria.capturar('Marquesina', marquesina.id);
    const ref = doc(this.firestore, `Marquesina/${marquesina.id}`);
    await setDoc(ref, marquesina, { merge: true });
    this.auditoria.registrar({
      accion: 'modificar', entidad: 'Marquesina', entidadId: marquesina.id,
      descripcion: 'Modificó un mensaje de marquesina', antes, despues: marquesina
    });
  }

    //SERVICE PARA ELIMINAR UNA MARQUESINA
  async eliminarMarquesina(id: string): Promise<void> {
    const antes = await this.auditoria.capturar('Marquesina', id);
    const docRef = doc(this.firestore, 'Marquesina', id);
    await deleteDoc(docRef);
    this.auditoria.registrar({
      accion: 'eliminar', entidad: 'Marquesina', entidadId: id,
      descripcion: `Eliminó un mensaje de marquesina: "${antes?.mensaje || ''}"`, antes
    });
  }
}