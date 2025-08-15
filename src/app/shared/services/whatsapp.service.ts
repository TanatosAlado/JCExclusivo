import { Injectable } from '@angular/core';
import { doc, docData, Firestore } from '@angular/fire/firestore';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class WhatsappService {

   constructor(private firestore: Firestore) { }

  //SERVICIO PARA ABRIR EL WHATSAPP
  abrirWhatsApp(numero: string, mensaje: string = ''): void {
   const numeroLimpio = numero.replace(/\D/g, '');
    const mensajeCodificado = encodeURIComponent(mensaje);
    const url = `https://wa.me/${numero}?text=${mensajeCodificado}`;
    window.open(url, '_blank');
  }

  // Trae el número de WhatsApp desde Firestore
  obtenerNumeroWhatsapp(): Observable<string | null> {
    const docRef = doc(this.firestore, 'infoEmpresa/general');
    return new Observable((observer) => {
      docData(docRef).subscribe((data: any) => {
        observer.next(data?.whatsapp || null);
      }, (error) => {
        console.error('Error al obtener número de WhatsApp', error);
        observer.next(null);
      });
    });
  }
}
