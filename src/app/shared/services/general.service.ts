import { Injectable } from '@angular/core';
import { BehaviorSubject, firstValueFrom, Observable } from 'rxjs';
import { Cliente } from 'src/app/modules/auth/models/cliente.model';
import { ClientesService } from './clientes.service';
import { CarritoService } from './carrito.service';
import { doc, Firestore, getDoc } from '@angular/fire/firestore';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { Producto } from 'src/app/modules/shop/models/producto.model';

@Injectable({
  providedIn: 'root'
})
export class GeneralService {

  private clienteSubject = new BehaviorSubject<Cliente | null>(null);

  constructor(private clientesService: ClientesService, private carritoService: CarritoService, private firestore: Firestore) {
    this.inicializarClienteDesdeStorage();
  }

  private async inicializarClienteDesdeStorage() {
    const clienteId = localStorage.getItem('cliente');

    if (clienteId === 'invitado') {
      const carritoRaw = localStorage.getItem('carritoInvitado');
      const carrito = carritoRaw ? JSON.parse(carritoRaw) : [];

      const clienteInvitado = new Cliente(
        false,             // administrador
        '',                // apellido
        [],                // carrito
        '',                 // cuit
        '',                // direccion
        null,                // dni
        false,             // esMayorista
        true,              // estado
        [],                // historial
        'invitado',        // id
        '',                // mail
        'Invitado',        // nombre
        0,                 // puntos
        '',                // razonSocial
        '',                // telefono
        'invitado',        // usuario
      );
      this.clienteSubject.next(clienteInvitado);

      // ✅ Asegurarse de que no haya residuos
      localStorage.setItem('cliente', 'invitado');
      return; // ⛔ Salir antes de buscar en Firebase
    }

    // Solo si no es invitado
    if (clienteId) {
      try {
        const cliente = await firstValueFrom(this.clientesService.getClienteById(clienteId));
        this.clienteSubject.next(cliente);
      } catch (e) {
        console.error('Error al obtener cliente logueado:', e);
      }
    }
  }



  //SERVICE PARA GUARDAR EL CLIENTE LOGUEADO EN EL LS
  setCliente(cliente: Cliente | null): void {
    const actual = this.clienteSubject.value;

    // Si ya está como 'invitado' y me quieren pisar con otro, lo ignoro
    if (actual?.id === 'invitado' && cliente && cliente.id !== 'invitado') {
      console.debug('[IGNORADO] Ya está como invitado. Ignorando nuevo cliente:', cliente?.id);
      return;
    }
    this.clienteSubject.next(cliente);

    if (cliente && cliente.id !== 'invitado') {
      localStorage.setItem('cliente', cliente.id);
      localStorage.setItem('clienteActual', JSON.stringify(cliente));
    } else {
      localStorage.removeItem('cliente');
      localStorage.setItem('clienteActual', JSON.stringify(cliente));
    }
  }

  getCliente(): Observable<Cliente | null> {
    return this.clienteSubject.asObservable();
  }

  getClienteActual(): Cliente | null {
    return this.clienteSubject.value;
  }

  //FUNCION PARA OBTENER LA CANTIDAD TOTAL A PAGAR DEL CARRITO DEL CLIENTE
  getTotalPrecio(cliente: any, usarPuntos: boolean = false, valorMonetarioPorPunto: number = 50, cuponAplicado: any = null): number {
    let total = cliente.carrito.reduce(
      (sum: number, prod: any) => sum + (prod.precioFinal * prod.cantidad),
      0
    );

    // Aplicar cupón si está disponible
    if (cuponAplicado && cuponAplicado.activo) {
      if (cuponAplicado.tipo === 'porcentaje') {
        const descuento = (cuponAplicado.valor / 100) * total;
        total -= descuento;
      } else if (cuponAplicado.tipo === 'monto') {
        total -= cuponAplicado.valor;
      }

      // Asegurarse de que el total no sea negativo
      total = Math.max(total, 0);
    }

    // Aplicar puntos si corresponde
    if (usarPuntos && cliente.puntos > 0) {
      const maxPuntosPorMonto = Math.floor(total / valorMonetarioPorPunto);
      const puntosUsables = Math.min(cliente.puntos, maxPuntosPorMonto);
      const descuento = puntosUsables * valorMonetarioPorPunto;
      total = Math.max(total - descuento, 0);
    }

    return total;
  }



  //FUNCION PARA OBTENER LA CANTIDAD TOTAL A PAGAR DEL CARRITO DEL CLIENTE
  getTotalPrecioDespacho(subtotal: any, puntos: number = 0, usarPuntos: boolean = false, valorMonetarioPorPunto: number = 50, cuponAplicado: any = null): number {
    let total = subtotal

    // Aplicar cupón si está disponible
    if (cuponAplicado && cuponAplicado.activo) {
      if (cuponAplicado.tipo === 'porcentaje') {
        const descuento = (cuponAplicado.valor / 100) * total;
        total -= descuento;
      } else if (cuponAplicado.tipo === 'monto') {
        total -= cuponAplicado.valor;
      }

      // Asegurarse de que el total no sea negativo
      total = Math.max(total, 0);
    }

    // Aplicar puntos si corresponde
    if (usarPuntos && puntos > 0) {
      const maxPuntosPorMonto = Math.floor(total / valorMonetarioPorPunto);
      const puntosUsables = Math.min(puntos, maxPuntosPorMonto);
      const descuento = puntosUsables * valorMonetarioPorPunto;
      total = Math.max(total - descuento, 0);
    }

    return total;
  }








  //SERVICE PARA TRAER CLIENTE POR ID
  // async getProductoById(id: string) {
  //   const productoRef = doc(this.firestore, `productos/${id}`);
  //   const productoSnap = await getDoc(productoRef);
  //   if (productoSnap.exists()) {
  //     return [{ id: productoSnap.id, ...productoSnap.data() }];
  //   }
  //   return [];
  // }

async getProductoById(id: string) {
  const productoRef = doc(this.firestore, `productos/${id}`);
  const productoSnap = await getDoc(productoRef);

  if (!productoSnap.exists()) return null;

  const producto: any = { id: productoSnap.id, ...productoSnap.data() };

  let idPadre = producto.id;

  // 👇 Si el producto tiene un padre, usamos ese id
  if (producto.productoPadre) {
    idPadre = producto.productoPadre;

    // Traemos los datos del padre
    const padreRef = doc(this.firestore, `productos/${idPadre}`);
    const padreSnap = await getDoc(padreRef);
    if (padreSnap.exists()) {
      Object.assign(producto, { ...padreSnap.data(), id: padreSnap.id });
    }
  }

  // 🔹 Ahora traemos las variantes del padre
  const variantesRef = collection(this.firestore, 'productos');
  const q = query(variantesRef, where('productoPadre', '==', idPadre));
  const querySnapshot = await getDocs(q);

  producto.variantes = querySnapshot.docs.map(docSnap => ({
    id: docSnap.id,
    ...docSnap.data()
  }));

  return producto;
}


  async getProductoByNombre(nombre: string) {
    console.log('nombre', nombre)
    const productosRef = collection(this.firestore, 'productos');
    const q = query(productosRef, where('id', '==', nombre));
    const querySnapshot = await getDocs(q);

    const productos: any[] = [];
    querySnapshot.forEach((doc) => {
      productos.push({ id: doc.id, ...doc.data() });
    });

    return productos;
  }


  //SERVICIO PARA CARGAR EN EL CARRITO EL PRODUCTO
cargarProductoCarrito(producto: Producto, cantidad: number = 1): Promise<boolean> {
  
        console.log('Producto a agregar (invitado):', producto);
  const calcularStockTotal = (p: any) => {
    if (!p.stockSucursales) return 0;
    // Si viene como objeto → sumamos los valores
    if (typeof p.stockSucursales === 'object' && !Array.isArray(p.stockSucursales)) {
      return Object.values(p.stockSucursales).reduce((acc: number, cant: any) => acc + (Number(cant) || 0), 0);
    }
    // Si viene como array
    return (p.stockSucursales || []).reduce((acc: number, s: any) => acc + (s?.cantidad || 0), 0);
  };

  return new Promise(async (resolve, reject) => {
    try {
      const clienteEncontrado = await firstValueFrom(this.getCliente());
      if (!clienteEncontrado) {
        reject('No se encontró el cliente');
        return;
      }

      // 🔹 Caso invitado: guardamos en localStorage
      if (clienteEncontrado.id === 'invitado') {
        const carritoRaw = localStorage.getItem('carritoInvitado');
        let carrito = carritoRaw ? JSON.parse(carritoRaw) : [];


        const index = carrito.findIndex(item => item.codigoBarras === producto.codigoBarras);
        if (index > -1) {
          carrito[index].cantidad += cantidad;
        } else {
          const uidCarrito = `${producto.id}-${(producto as any).modelo ?? ''}-${(producto as any).color ?? ''}`;

          carrito.push({
            uidCarrito,
            id: producto.id,
            codigoBarras: producto.codigoBarras,
            imagen: producto.imagen,
            nombre: producto.descripcion,
            cantidad,
            oferta: producto.oferta,
            precioOferta: producto.precioOferta ?? null,
            precioFinal: producto.oferta && producto.precioOferta
              ? producto.precioOferta
              : producto.precioMinorista,
            stock: calcularStockTotal(producto),
            color: (producto as any).color || null,
            modelo: (producto as any).modelo || null
          });
        }

        localStorage.setItem('carritoInvitado', JSON.stringify(carrito));
        this.carritoService.actualizarCantidadProductosDesdeLocalStorage();


        const clienteActualizado = new Cliente(
          false, '', carrito, '', '', null, false,
          true, [], 'invitado', '', 'Invitado',
          0, '', '', 'invitado'
        );
        this.clienteSubject.next(clienteActualizado);
        resolve(true);
        return;
      }

      // 🔹 Caso cliente logueado
      const index = clienteEncontrado.carrito.findIndex(
        item => item.codigoBarras === producto.codigoBarras
      );

      if (index > -1) {
        clienteEncontrado.carrito[index].cantidad += cantidad;
      } else {
          const uidCarrito = `${producto.id}-${(producto as any).modelo ?? ''}-${(producto as any).color ?? ''}`;
          clienteEncontrado.carrito.push({
            uidCarrito,
            id: producto.id,
            codigoBarras: producto.codigoBarras,
            imagen: producto.imagen,
            nombre: producto.descripcion,
            cantidad,
            oferta: producto.oferta,
            precioOferta: producto.precioOferta ?? null,
            precioFinal: producto.oferta && producto.precioOferta
              ? producto.precioOferta
              : producto.precioMinorista,
            stock: calcularStockTotal(producto),
            color: (producto as any).color || null,
            modelo: (producto as any).modelo || null
          });
      }

      const datosLimpios = JSON.parse(JSON.stringify(clienteEncontrado));
      await this.clientesService.actualizarCliente(clienteEncontrado.id, datosLimpios);

      this.carritoService.actualizarCantidadProductos(clienteEncontrado);
      this.clienteSubject.next(clienteEncontrado);
      resolve(true);
    } catch (error) {
      reject('Error general en cargarProductoCarrito: ' + error);
    }
  });
}




  
  //FUNCION PARA FORMATEAR FECHA
  formatearFechaDesdeDate(fecha: Date): string {
    const dia = fecha.getDate().toString().padStart(2, '0');
    const mes = (fecha.getMonth() + 1).toString().padStart(2, '0');
    const anio = fecha.getFullYear();
    const horas = fecha.getHours().toString().padStart(2, '0');
    const minutos = fecha.getMinutes().toString().padStart(2, '0');

    return `${dia}/${mes}/${anio} ${horas}:${minutos}`;
  }
}



