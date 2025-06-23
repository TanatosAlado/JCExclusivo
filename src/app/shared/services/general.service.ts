import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { Cliente } from 'src/app/modules/auth/models/cliente.model';

@Injectable({
  providedIn: 'root'
})
export class GeneralService {

  private clienteSubject = new BehaviorSubject<Cliente | null>(null);
  constructor() { }


  //SERVICE PARA GUARDAR EL CLIENTE LOGUEADO EN EL LS
    setCliente(cliente: Cliente) {
    this.clienteSubject.next(cliente);
    localStorage.setItem('cliente', cliente.id);
  }
}
