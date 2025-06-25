import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { Cliente } from 'src/app/modules/auth/models/cliente.model';
import { ClientesService } from './clientes.service';
import { CarritoService } from './carrito.service';

@Injectable({
  providedIn: 'root'
})
export class GeneralService {

  private clienteSubject = new BehaviorSubject<Cliente | null>(null);
  constructor(private clientesService:ClientesService, private carritoService:CarritoService) { }


  //SERVICE PARA GUARDAR EL CLIENTE LOGUEADO EN EL LS
    setCliente(cliente: Cliente) {
    this.clienteSubject.next(cliente);
    localStorage.setItem('cliente', cliente.id);
  }

   getCliente(): Observable<Cliente | null> {
    return this.clienteSubject.asObservable();
  }

  getClienteActual(): Cliente | null {
    return this.clienteSubject.value;
  }

   //FUNCION PARA OBTENER LA CANTIDAD TOTAL A PAGAR DEL CARRITO DEL CLIENTE
   getTotalPrecio(cliente: any): number {
    return cliente.carrito.reduce((total: number, prod: any) => total + (prod.precioFinal * prod.cantidad), 0);
  }

  //SERVICIO PARA CARGAR EN EL CARRITO EL PRODUCTO
  cargarProductoCarrito(producto: any, cantidad: number = 1): Promise<boolean> {
  return new Promise((resolve, reject) => {
    this.getCliente().subscribe({
      next: (clienteEncontrado) => {
        if (!clienteEncontrado) {
          reject('No se encontró el cliente');
          return;
        }

        const productoExistente = clienteEncontrado.carrito.find(item => item.id === producto.id);

        if (productoExistente) {
          productoExistente.cantidad += cantidad;
        } else {
          clienteEncontrado.carrito.push({
            id: producto.id,
            imagen: producto.imagen,
            nombre: producto.nombre,
            cantidad: cantidad,
            precioOferta: producto.oferta,
            stock:producto.stock,
            precioFinal:producto.oferta? producto.precioOferta: producto.precioMinorista,
          });
        }

        const datosLimpios = JSON.parse(JSON.stringify(clienteEncontrado));
        this.clientesService.actualizarCliente(clienteEncontrado.id, datosLimpios)
          .then(() => {
            this.carritoService.actualizarCantidadProductos(clienteEncontrado);
            resolve(true);
          })
          .catch((err) => reject('Error al actualizar cliente: ' + err));
      },
      error: (err) => {
        reject('Error al obtener cliente: ' + err);
      }
    });
  });
}

}
