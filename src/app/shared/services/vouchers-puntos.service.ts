import { Injectable } from '@angular/core';
import { doc, getDoc } from 'firebase/firestore';
import { Firestore, setDoc } from '@angular/fire/firestore';

@Injectable({
  providedIn: 'root'
})
export class VouchersPuntosService {

  private valoresPuntos: { valorParaSumarPunto: number, valorMonetarioPorPunto: number } | null = null;

  constructor(private firestore: Firestore) {}

  async obtenerValoresPuntos(): Promise<{ valorParaSumarPunto: number, valorMonetarioPorPunto: number }> {
    if (this.valoresPuntos) {
      return this.valoresPuntos;
    }

    const docRef = doc(this.firestore, 'configuracion/puntosMembresia');
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      this.valoresPuntos = docSnap.data() as any;
    } else {
      this.valoresPuntos = { valorParaSumarPunto: 200, valorMonetarioPorPunto: 50 };
    }

    return this.valoresPuntos;
  }

  // Opcional: Forzar recarga si editás la config desde otro lado
  resetearCache() {
    this.valoresPuntos = null;
  }

  async actualizarValoresPuntos(data: { valorParaSumarPunto: number, valorMonetarioPorPunto: number }): Promise<void> {
  const docRef = doc(this.firestore, 'configuracion/puntosMembresia');
  await setDoc(docRef, data, { merge: true });
  this.valoresPuntos = null; // limpia cache para forzar recarga
}
}