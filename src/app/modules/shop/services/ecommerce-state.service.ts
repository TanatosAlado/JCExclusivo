import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class EcommerceStateService {

  constructor() { }


  filtros: any = null;

  guardarEstado(data: any) {
    this.filtros = data;
  }

  obtenerEstado() {
    return this.filtros;
  }

  limpiarEstado() {
    this.filtros = null;
  }
}
