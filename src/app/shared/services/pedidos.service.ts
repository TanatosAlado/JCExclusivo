import { Injectable } from '@angular/core';
import { addDoc, collection, doc, Firestore, updateDoc } from '@angular/fire/firestore';
import { Pedido } from 'src/app/modules/shop/models/pedido.model';

@Injectable({
  providedIn: 'root'
})
export class PedidosService {

  constructor(private firestore: Firestore) { }

  //SERVICE PARA CREAR PEDIDO
  createPedido(pedido: Pedido): Promise<any> {
    const clienteRef = collection(this.firestore, 'Pedidos Pendientes');
    
    return addDoc(clienteRef, pedido);
  }

   //SERVICE PARA ACTUALIZAR UN PEDIDO
  updatePedido(id: string, pedido: any) {
    const productoRef = doc(this.firestore, 'Pedidos Pendientes', id);
    return updateDoc(productoRef, pedido);
  }
}
