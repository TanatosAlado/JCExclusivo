import { Injectable } from '@angular/core';
import { doc, getDoc } from 'firebase/firestore';
import { addDoc, collection, collectionData, deleteDoc, Firestore, getDocs, query, setDoc, updateDoc, where } from '@angular/fire/firestore';
import { Cupon } from 'src/app/modules/admin/models/cupones.model';
import { Observable } from 'rxjs';
import { AuditoriaService } from 'src/app/shared/services/auditoria.service';

@Injectable({
  providedIn: 'root'
})
export class VouchersPuntosService {

  private valoresPuntos: { valorParaSumarPunto: number, valorMonetarioPorPunto: number } | null = null;
  private cuponesRef = collection(this.firestore, 'Cupones');
  private puntosDocRef = doc(this.firestore, 'configuracion/puntosMembresia');
  private montosRef = doc(this.firestore, 'configuracion/montosMayorista');

  constructor(private firestore: Firestore, private auditoria: AuditoriaService) { }

  // Opcional: Forzar recarga si editás la config desde otro lado
  resetearCache() {
    this.valoresPuntos = null;
  }

  obtenerCupones(): Observable<CuponConId[]> {
    return collectionData(this.cuponesRef, { idField: 'id' }) as Observable<CuponConId[]>;
  }

  async crearCupon(cupon: Cupon) {
    const docRef = await addDoc(this.cuponesRef, cupon);
    this.auditoria.registrar({
      accion: 'crear',
      entidad: 'Cupones',
      entidadId: docRef.id,
      descripcion: `Creó el cupón ${cupon.codigo} (${cupon.tipo === 'porcentaje' ? cupon.valor + '%' : '$' + cupon.valor})`,
      despues: cupon
    });
    return docRef;
  }

  async actualizarCupon(cuponId: string, cambios: Partial<Cupon>) {
    const antes = await this.auditoria.capturar('Cupones', cuponId);
    const docRef = doc(this.firestore, 'Cupones', cuponId);
    await updateDoc(docRef, cambios);
    this.auditoria.registrar({
      accion: 'modificar',
      entidad: 'Cupones',
      entidadId: cuponId,
      descripcion: `Modificó el cupón ${antes?.codigo || cuponId}`,
      antes,
      despues: cambios
    });
  }

  async eliminarCupon(cuponId: string) {
    const antes = await this.auditoria.capturar('Cupones', cuponId);
    const docRef = doc(this.firestore, 'Cupones', cuponId);
    await deleteDoc(docRef);
    this.auditoria.registrar({
      accion: 'eliminar',
      entidad: 'Cupones',
      entidadId: cuponId,
      descripcion: `Eliminó el cupón ${antes?.codigo || cuponId}`,
      antes
    });
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

  async guardarValoresPuntos(valores: any): Promise<void> {
    const antes = await this.auditoria.capturar('configuracion', 'puntosMembresia');
    await setDoc(this.puntosDocRef, valores, { merge: true });
    this.auditoria.registrar({
      accion: 'modificar',
      entidad: 'configuracion',
      entidadId: 'puntosMembresia',
      descripcion: 'Modificó la configuración de puntos',
      antes,
      despues: valores
    });
  }

  obtenerMontosMayoristas(): Promise<any> {
    return getDoc(this.montosRef).then((docSnap) => {
      return docSnap.exists() ? docSnap.data() : null;
    });
  }

  async guardarMontosMayorista(valores: any): Promise<void> {
    const antes = await this.auditoria.capturar('configuracion', 'montosMayorista');
    await setDoc(this.montosRef, valores, { merge: true });
    this.auditoria.registrar({
      accion: 'modificar',
      entidad: 'configuracion',
      entidadId: 'montosMayorista',
      descripcion: 'Modificó los montos mínimos mayoristas',
      antes,
      despues: valores
    });
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