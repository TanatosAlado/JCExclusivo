import { Injectable } from '@angular/core';
import { Firestore, doc, docData } from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { InfoEmpresa } from '../models/infoEmpresa.model';



@Injectable({
  providedIn: 'root'
})
export class InfoEmpresaService {

  constructor(private firestore: Firestore) {}

  obtenerInfoGeneral(): Observable<InfoEmpresa | null> {
    const docRef = doc(this.firestore, 'InfoEmpresa/general');
    return new Observable((observer) => {
      docData(docRef).subscribe((data: any) => {
        observer.next(data as InfoEmpresa);
      }, (error) => {
        console.error('Error al obtener info de empresa', error);
        observer.next(null);
      });
    });
  }
}