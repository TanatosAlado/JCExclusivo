import { Injectable } from '@angular/core';
import { Firestore, collection, addDoc, updateDoc, deleteDoc, doc, collectionData, DocumentReference } from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { Sucursal } from '../models/sucursal.model';
import { AuditoriaService } from 'src/app/shared/services/auditoria.service';

@Injectable({
  providedIn: 'root'
})
export class SucursalesService {

  private sucursalesCollection = collection(this.firestore, 'Sucursales');

  constructor(private firestore: Firestore, private auditoria: AuditoriaService) {}

  // Obtener todas las sucursales
  obtenerSucursales(): Observable<Sucursal[]> {
    return collectionData(this.sucursalesCollection, { idField: 'id' }) as Observable<Sucursal[]>;
  }

  // Crear una nueva sucursal
  async agregarSucursal(sucursal: Sucursal): Promise<DocumentReference> {
    const docRef = await addDoc(this.sucursalesCollection, sucursal);
    this.auditoria.registrar({
      accion: 'crear', entidad: 'Sucursales', entidadId: docRef.id,
      descripcion: `Creó la sucursal "${sucursal.nombre}"`, despues: sucursal
    });
    return docRef;
  }

  // Actualizar sucursal existente
  async actualizarSucursal(id: string, sucursal: Partial<Sucursal>): Promise<void> {
    const antes = await this.auditoria.capturar('Sucursales', id);
    const docRef = doc(this.firestore, `Sucursales/${id}`);
    await updateDoc(docRef, sucursal);
    this.auditoria.registrar({
      accion: 'modificar', entidad: 'Sucursales', entidadId: id,
      descripcion: `Modificó la sucursal "${antes?.nombre || sucursal.nombre || id}"`, antes, despues: sucursal
    });
  }

  // Eliminar sucursal
  async eliminarSucursal(id: string): Promise<void> {
    const antes = await this.auditoria.capturar('Sucursales', id);
    const docRef = doc(this.firestore, `Sucursales/${id}`);
    await deleteDoc(docRef);
    this.auditoria.registrar({
      accion: 'eliminar', entidad: 'Sucursales', entidadId: id,
      descripcion: `Eliminó la sucursal "${antes?.nombre || id}"`, antes
    });
  }
}