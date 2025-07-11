import { Injectable } from '@angular/core';
import { doc, Firestore, getDoc, updateDoc } from '@angular/fire/firestore';
import { BehaviorSubject } from 'rxjs';
import { Cliente } from 'src/app/modules/auth/models/cliente.model';

@Injectable({
  providedIn: 'root'
})
export class CarritoService {

  private carritoSubject = new BehaviorSubject<any[]>([]);
  carrito$ = this.carritoSubject.asObservable();

  private cantidadProductosSubject = new BehaviorSubject<number>(0);
  cantidadProductos$ = this.cantidadProductosSubject.asObservable();

  constructor(private firestore: Firestore) { }

  actualizarCantidadProductos(cliente: Cliente) {
    if (!cliente || !cliente.carrito) {
      this.cantidadProductosSubject.next(0);
      return;
    } else {
      const total = cliente.carrito?.reduce((sum, p) => sum + p.cantidad, 0) || 0;
      this.cantidadProductosSubject.next(total);
    }

  }

  // SERVICIO PARA ELIMINAR UN PRODUCTO DEL CARRITO ID
  async deleteProductoCarrito(clienteId: string, productoId: string): Promise<void> {
    const clienteRef = doc(this.firestore, `Clientes/${clienteId}`);
    try {
      const clienteSnap = await getDoc(clienteRef);
      if (clienteSnap.exists()) {
        const clienteData = clienteSnap.data();
        const carritoActual = clienteData['carrito'] || [];
        const nuevoCarrito = carritoActual.filter((producto: any) => producto.id !== productoId);
        await updateDoc(clienteRef, { carrito: nuevoCarrito });
        this.carritoSubject.next(nuevoCarrito);

      }
    } catch (error) {
    }
  }

  actualizarCantidadProductosDesdeLocalStorage(): void {
    const carritoRaw = localStorage.getItem('carritoInvitado');
    const carrito = carritoRaw ? JSON.parse(carritoRaw) : [];
    const total = carrito.reduce((sum, item) => sum + item.cantidad, 0);
    this.cantidadProductosSubject.next(total);
  }


}
