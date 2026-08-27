import { Injectable } from '@angular/core';
import { BehaviorSubject, firstValueFrom, Observable } from 'rxjs';
import { Cliente } from 'src/app/modules/auth/models/cliente.model';
import { ClientesService } from './clientes.service';
import { CarritoService } from './carrito.service';
import { doc, Firestore, getDoc } from '@angular/fire/firestore';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { Producto } from 'src/app/modules/shop/models/producto.model';
import { InfoEmpresaService } from './info-empresa.service';

@Injectable({
  providedIn: 'root'
})
export class GeneralService {

  private clienteSubject = new BehaviorSubject<Cliente | null>(null);
  dolar: number = 1;

  constructor(private clientesService: ClientesService, private carritoService: CarritoService, private firestore: Firestore, private infoEmpresaService: InfoEmpresaService) {
    this.inicializarClienteDesdeStorage();
  }

    async ngOnInit() {
      this.getCliente()
      this.infoEmpresaService.obtenerInfoGeneral().subscribe(info => {
        if (info?.dolar) {
          this.dolar = info.dolar;
        }
      });
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

  getTotalPrecio(
    cliente: any,
    usarPuntos: boolean = false,
    valorMonetarioPorPunto: number = 50,
    cuponAplicado: any = null
  ): number {
    let total = (cliente.carrito || []).reduce((sum: number, prod: any) => {
      let precio = Number(prod.precioFinal) || 0;

      if (prod.moneda === 'USD') {
        precio *= this.dolar;
      }
      const cantidad = Number(prod.cantidad) || 0;
      return sum + (precio * cantidad);
    }, 0);

    // Aplicar cupón si está disponible
    if (cuponAplicado && cuponAplicado.activo) {
      if (cuponAplicado.tipo === 'porcentaje') {
        const descuento = (cuponAplicado.valor / 100) * total;
        total -= descuento;
      } else if (cuponAplicado.tipo === 'monto') {
        total -= cuponAplicado.valor;
      }
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

    const calcularStockSegunCliente = (p: any, cliente: Cliente) => {

      const calcularMinorista = () => {

        if (!p.stockSucursales) return 0;

        if (
          typeof p.stockSucursales === 'object' &&
          !Array.isArray(p.stockSucursales)
        ) {
          return Object.values(p.stockSucursales)
            .reduce(
              (acc: number, cant: any) =>
                acc + (Number(cant) || 0),
              0
            );
        }

        return (p.stockSucursales || [])
          .reduce(
            (acc: number, s: any) =>
              acc + (Number(s?.cantidad) || 0),
            0
          );
      };

      if (cliente.esMayorista) {
        return Number(p.stockMayorista) || 0;
      }

      return calcularMinorista();
    };

    return new Promise(async (resolve, reject) => {

      try {

        const clienteEncontrado =
          await firstValueFrom(this.getCliente());

        if (!clienteEncontrado) {
          reject('No se encontró el cliente');
          return;
        }

        // ============================================================
        // VALIDACIÓN BÁSICA
        // ============================================================

        if (cantidad <= 0) {
          reject('La cantidad debe ser mayor a cero');
          return;
        }

        const uidCarrito =
          this.generarUidCarrito(producto);


        // ============================================================
        // CASO INVITADO
        // ============================================================

        if (clienteEncontrado.id === 'invitado') {

          const carritoRaw =
            localStorage.getItem('carritoInvitado');

          let carrito =
            carritoRaw ? JSON.parse(carritoRaw) : [];


          const index =
            carrito.findIndex(
              (item: any) =>
                item.uidCarrito === uidCarrito
            );


          // Stock REAL del producto
          const stockDisponible =
            calcularStockSegunCliente(
              producto,
              clienteEncontrado
            );


          // Cantidad que ya tenemos en carrito
          const cantidadEnCarrito =
            index > -1
              ? Number(carrito[index].cantidad) || 0
              : 0;


          // Cantidad TOTAL después de agregar
          const cantidadFinal =
            cantidadEnCarrito + cantidad;

          // ============================================================
          // 🚨 CONTROL DE STOCK
          // ============================================================

          if (cantidadFinal > stockDisponible) {

            reject({
              tipo: 'STOCK_INSUFICIENTE',
              stockDisponible,
              cantidadEnCarrito,
              cantidadSolicitada: cantidad,
              cantidadFinal
            });

            return;

            return;
          }


          const obtenerPrecio =
            (p: Producto, cliente: Cliente) => {

              if (p.oferta && p.precioOferta) {
                return p.precioOferta;
              }

              return cliente.esMayorista
                ? p.precioMayorista
                : p.precioMinorista;
            };


          // ============================================================
          // ACTUALIZAR CARRITO
          // ============================================================

          if (index > -1) {

            carrito[index].cantidad =
              cantidadFinal;

          } else {

            carrito.push({
              uidCarrito,

              id: producto.id,

              codigoBarras:
                producto.codigoBarras,

              imagen:
                producto.imagen,

              nombre:
                producto.descripcion,

              cantidad,

              oferta:
                producto.oferta,

              precioOferta:
                producto.precioOferta ?? null,

              precioFinal:
                obtenerPrecio(
                  producto,
                  clienteEncontrado
                ),

              moneda:
                producto.moneda || 'ARS',

              stock:
                stockDisponible,

              color:
                (producto as any).color || null,

              modelo:
                (producto as any).modelo || null
            });
          }


          localStorage.setItem(
            'carritoInvitado',
            JSON.stringify(carrito)
          );

          this.carritoService
            .actualizarCantidadProductosDesdeLocalStorage();


          const clienteActualizado =
            new Cliente(
              false,
              '',
              carrito,
              '',
              '',
              null,
              false,
              true,
              [],
              'invitado',
              '',
              'Invitado',
              0,
              '',
              '',
              'invitado'
            );


          this.clienteSubject.next(
            clienteActualizado
          );

          resolve(true);
          return;
        }


        // ============================================================
        // CLIENTE LOGUEADO
        // ============================================================

        const index =
          clienteEncontrado.carrito.findIndex(
            (item: any) =>
              item.uidCarrito === uidCarrito
          );


        // Stock REAL del producto
        const stockDisponible =
          calcularStockSegunCliente(
            producto,
            clienteEncontrado
          );


        // Cantidad existente en carrito
        const cantidadEnCarrito =
          index > -1
            ? Number(
                clienteEncontrado.carrito[index].cantidad
              ) || 0
            : 0;


        // Cantidad final que tendría el carrito
        const cantidadFinal =
          cantidadEnCarrito + cantidad;

        // ============================================================
        // 🚨 CONTROL DE STOCK
        // ============================================================

        if (cantidadFinal > stockDisponible) {

          reject({
            tipo: 'STOCK_INSUFICIENTE',
            stockDisponible,
            cantidadEnCarrito,
            cantidadSolicitada: cantidad,
            cantidadFinal
          });

          return;
        }


        const obtenerPrecio =
          (p: Producto, cliente: Cliente) => {

            if (p.oferta && p.precioOferta) {
              return p.precioOferta;
            }

            return cliente.esMayorista
              ? p.precioMayorista
              : p.precioMinorista;
          };


        // ============================================================
        // ACTUALIZAR CARRITO
        // ============================================================

        if (index > -1) {

          clienteEncontrado
            .carrito[index]
            .cantidad = cantidadFinal;

        } else {

          clienteEncontrado.carrito.push({

            uidCarrito,

            id: producto.id,

            codigoBarras:
              producto.codigoBarras,

            imagen:
              producto.imagen,

            nombre:
              producto.descripcion,

            cantidad,

            oferta:
              producto.oferta,

            precioOferta:
              producto.precioOferta ?? null,

            precioFinal:
              obtenerPrecio(
                producto,
                clienteEncontrado
              ),

            moneda:
              producto.moneda || 'ARS',

            stock:
              stockDisponible,

            color:
              (producto as any).color || null,

            modelo:
              (producto as any).modelo || null
          });
        }


        // ============================================================
        // GUARDAR CLIENTE
        // ============================================================

        const datosLimpios =
          JSON.parse(
            JSON.stringify(clienteEncontrado)
          );


        await this.clientesService
          .actualizarCliente(
            clienteEncontrado.id,
            datosLimpios
          );


        this.carritoService
          .actualizarCantidadProductos(
            clienteEncontrado
          );


        this.clienteSubject.next(
          clienteEncontrado
        );


        resolve(true);

      } catch (error) {

        reject(
          'Error general en cargarProductoCarrito: ' +
          error
        );

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

  private generarUidCarrito(producto: any): string {
    return `${producto.id}-${producto.modelo ?? ''}-${producto.color ?? ''}`;
  }

}



