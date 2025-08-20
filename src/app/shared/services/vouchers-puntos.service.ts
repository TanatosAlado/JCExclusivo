import { Injectable } from '@angular/core';
import { doc, getDoc } from 'firebase/firestore';
import { addDoc, collection, collectionData, deleteDoc, Firestore, getDocs, query, setDoc, updateDoc, where } from '@angular/fire/firestore';
import { Cupon } from 'src/app/modules/admin/models/cupones.model';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class VouchersPuntosService {

  private valoresPuntos: { valorParaSumarPunto: number, valorMonetarioPorPunto: number } | null = null;
  private cuponesRef = collection(this.firestore, 'Cupones');
  private puntosDocRef = doc(this.firestore, 'configuracion/puntosMembresia');
  private montosRef = doc(this.firestore, 'configuracion/montosMayorista');

  constructor(private firestore: Firestore) { }

  // Opcional: Forzar recarga si editás la config desde otro lado
  resetearCache() {
    this.valoresPuntos = null;
  }

  obtenerCupones(): Observable<CuponConId[]> {
    return collectionData(this.cuponesRef, { idField: 'id' }) as Observable<CuponConId[]>;
  }

  crearCupon(cupon: Cupon) {
    return addDoc(this.cuponesRef, cupon);
  }

  actualizarCupon(cuponId: string, cambios: Partial<Cupon>) {
    const docRef = doc(this.firestore, 'Cupones', cuponId);
    return updateDoc(docRef, cambios);
  }

  eliminarCupon(cuponId: string) {
    const docRef = doc(this.firestore, 'Cupones', cuponId);
    return deleteDoc(docRef);
  }

  async buscarCuponPorCodigo(codigo: string): Promise<CuponConId | null> {
    const q = query(this.cuponesRef, where('codigo', '==', codigo), where('activo', '==', true));
    const snapshot = await getDocs(q);
    if (snapshot.empty) return null;
    const docSnap = snapshot.docs[0];
    return { id: docSnap.id, ...(docSnap.data() as Cupon) };
  }

  obtenerValoresPuntos(): Promise<any> {
    return getDoc(this.puntosDocRef).then((docSnap) => {
      return docSnap.exists() ? docSnap.data() : null;
    });
  }

  guardarValoresPuntos(valores: any): Promise<void> {
    return setDoc(this.puntosDocRef, valores, { merge: true });
  }

  obtenerMontosMayoristas(): Promise<any> {
    return getDoc(this.montosRef).then((docSnap) => {
      return docSnap.exists() ? docSnap.data() : null;
    });
  }

  guardarMontosMayorista(valores: any): Promise<void> {
    return setDoc(this.montosRef, valores, { merge: true });
  }


  async marcarCuponComoUsado(id: string) {
    const docRef = doc(this.firestore, 'Cupones', id);
    const cuponSnap = await getDoc(docRef);

    if (!cuponSnap.exists()) return;

    const cupon = cuponSnap.data();
    let nuevaCantidad = (cupon['cantidadDisponible'] || 1) - 1;

    const actualizaciones: any = {
      cantidadDisponible: nuevaCantidad
    };

    if (nuevaCantidad <= 0) {
      actualizaciones.activo = false;
    }

    return updateDoc(docRef, actualizaciones);
  }

  obtenerCuponPorCodigo(codigo: string): Promise<Cupon | null> {

    const ref = collection(this.firestore, 'Cupones');
    const q = query(ref, where('codigo', '==', codigo), where('activo', '==', true));

    return getDocs(q).then((snap) => {
      if (!snap.empty) {
        const doc = snap.docs[0];
        return { id: doc.id, ...doc.data() } as Cupon;
      } else {
        return null;
      }
    });
  }


}

export interface CuponConId extends Cupon {
  id: string;
}