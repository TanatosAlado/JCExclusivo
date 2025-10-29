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
  // async deleteProductoCarrito(clienteId: string, productoId: string): Promise<void> {
  //   const clienteRef = doc(this.firestore, `Clientes/${clienteId}`);
  //   try {
  //     const clienteSnap = await getDoc(clienteRef);
  //     if (clienteSnap.exists()) {
  //       const clienteData = clienteSnap.data();
  //       const carritoActual = clienteData['carrito'] || [];
  //       const nuevoCarrito = carritoActual.filter((producto: any) => producto.id !== productoId);
  //       await updateDoc(clienteRef, { carrito: nuevoCarrito });
  //       this.carritoSubject.next(nuevoCarrito);

  //     }
  //   } catch (error) {
  //   }
  // }
  async deleteProductoCarrito(clienteId: string, uidCarrito: string): Promise<void> {
  if (clienteId === 'invitado') {
    // 🔹 Manejo local para el invitado
    const carritoRaw = localStorage.getItem('carritoInvitado');
    if (!carritoRaw) return;

    const carrito = JSON.parse(carritoRaw);
    const nuevoCarrito = carrito.filter((producto: any) => producto.uidCarrito !== uidCarrito);

    // 🔹 Guardar nuevo carrito
    localStorage.setItem('carritoInvitado', JSON.stringify(nuevoCarrito));

    // 🔹 Notificar cambios
    this.actualizarCantidadProductosDesdeLocalStorage();
    this.carritoSubject.next(nuevoCarrito);
    return;
  }

  // 🔹 Caso usuario logueado (en Firestore)
  const clienteRef = doc(this.firestore, `Clientes/${clienteId}`);
  try {
    const clienteSnap = await getDoc(clienteRef);
    if (clienteSnap.exists()) {
      const clienteData = clienteSnap.data();
      const carritoActual = clienteData['carrito'] || [];

      // 🔹 Filtrar por uidCarrito en lugar de id
      const nuevoCarrito = carritoActual.filter((producto: any) => producto.uidCarrito !== uidCarrito);

      // 🔹 Actualizar Firestore
      await updateDoc(clienteRef, { carrito: nuevoCarrito });

      // 🔹 Notificar cambios locales
      this.carritoSubject.next(nuevoCarrito);
    }
  } catch (error) {
    console.error('Error al eliminar producto del carrito:', error);
  }
}


  actualizarCantidadProductosDesdeLocalStorage(): void {
    const carritoRaw = localStorage.getItem('carritoInvitado');
    const carrito = carritoRaw ? JSON.parse(carritoRaw) : [];
    const total = carrito.reduce((sum, item) => sum + item.cantidad, 0);
    this.cantidadProductosSubject.next(total);
  }


}
