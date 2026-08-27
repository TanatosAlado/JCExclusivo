import { Injectable } from '@angular/core';
import { addDoc, collection, collectionData, deleteDoc, doc, Firestore, getDoc, runTransaction, setDoc, updateDoc } from '@angular/fire/firestore';
import { Observable } from 'rxjs';
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
  // SERVICIO PARA ELIMINAR UN PEDIDO POR ID
  async deletePedidoById(id: string, tabla: string): Promise<void> {
    const productoRef = doc(this.firestore, `${tabla}/${id}`);
    try {
      await deleteDoc(productoRef);
     // this.getPedidos(tabla);
    } catch (error) {
      console.error('Error al eliminar el producto:', error);
    }
  }
   getPedidosPorTipo(tipo: string): Observable<Pedido[]> {
    const colRef = collection(this.firestore, tipo);
    return collectionData(colRef, { idField: 'id' }) as Observable<Pedido[]>;
  }

    //SERVICIO PARA ACTUALIZAR LA CANTIDAD DE PRODUCTOS Y TOTAL EN PEDIDOS PENDIENTES
  updateCarroEnPedido(idPedido: string, nuevoCarro: any[]) {
    const nuevoTotal = nuevoCarro.reduce((acc, item) => acc + item.precioFinal * item.cantidad, 0);
    const pedidoRef = doc(this.firestore, 'Pedidos Pendientes', idPedido);
    return updateDoc(pedidoRef, {
      carrito: nuevoCarro,
      total: nuevoTotal
    });
  }

    deleteProductoDelCarrito(idPedido: string, idProducto: string) {
    const pedidoRef = doc(this.firestore, 'Pedidos Pendientes', idPedido);

    return getDoc(pedidoRef).then((docSnap) => {
      if (!docSnap.exists()) {
        throw new Error('Pedido no encontrado');
      }
      const pedidoData = docSnap.data();
      const carritoActual = pedidoData['carrito'] || [];
      const carritoActualizado = carritoActual.filter((producto: any) => producto.id !== idProducto);
      if (carritoActualizado.length === 0) {
        return deleteDoc(pedidoRef);
      }
      const totalActualizado = carritoActualizado.reduce(
        (acc: number, producto: any) => acc + producto.precioFinal * producto.cantidad, 0
      );

      return updateDoc(pedidoRef, {
        carrito: carritoActualizado,
        total: totalActualizado
      });
    });
  }

  async moverDocumento(
    id: string,
    origen: string,
    destino: string
  ): Promise<void> {

    try {

      const refOrigen = doc(this.firestore, origen, id);
      const snap = await getDoc(refOrigen);

      if (!snap.exists()) {
        throw new Error('El pedido no existe.');
      }

      const data: any = snap.data();

      // =====================================================
      // DEVOLVER STOCK
      // =====================================================

      // Solamente cuando:
      // PEDIDOS PENDIENTES → PEDIDOS ELIMINADOS

      if (
        origen === 'Pedidos Pendientes' &&
        destino === 'Pedidos Eliminados'
      ) {

        // Evitamos devolver dos veces
        if (data.stockDevuelto !== true) {

          await this.devolverStockPedido(data);

          // Marcamos que el stock ya fue devuelto
          data.stockDevuelto = true;

        } else {

          console.log(
            '⚠️ El stock de este pedido ya había sido devuelto.'
          );

        }
      }

      // =====================================================
      // DETERMINAR NUEVO ESTADO
      // =====================================================

      let nuevoEstado = '';

      if (destino === 'Pedidos Finalizados') {

        nuevoEstado = 'Finalizado';

      } else if (destino === 'Pedidos Pendientes') {

        nuevoEstado = 'Pendiente';

      } else if (destino === 'Pedidos Eliminados') {

        nuevoEstado = 'Eliminado';

      }

      // =====================================================
      // ACTUALIZAR PEDIDO
      // =====================================================

      const dataActualizada = {

        ...data,

        estado: nuevoEstado

      };

      // =====================================================
      // GUARDAR EN DESTINO
      // =====================================================

      const refDestino =
        doc(this.firestore, destino, id);

      await setDoc(
        refDestino,
        dataActualizada
      );

      // =====================================================
      // ELIMINAR DEL ORIGEN
      // =====================================================

      await deleteDoc(refOrigen);

    } catch (err) {

      console.error(
        '❌ Error al mover documento:',
        err
      );

      throw err;
    }
  }


  private async devolverStockPedido(pedido: any): Promise<void> {

    const carrito = pedido.carrito || [];

    if (!carrito.length) {

      console.log(
        '⚠️ El pedido no tiene productos para devolver.'
      );

      return;
    }

    for (const item of carrito) {

      // =====================================================
      // VALIDACIONES
      // =====================================================

      if (!item.stockDescontado) {

        console.warn(
          '⚠️ El producto no tiene información de stock descontado:',
          item
        );

        continue;
      }

      let productDocId = item.id;

      if (!productDocId && item.productoPadre) {

        productDocId = item.productoPadre;

      }

      if (!productDocId) {

        console.warn(
          '⚠️ No se encontró ID del producto:',
          item
        );

        continue;
      }

      // =====================================================
      // RESOLVER ID REAL DEL PRODUCTO
      // =====================================================

      if (productDocId.includes('-')) {

        const first =
          productDocId.split('-')[0];

        const testRef =
          doc(
            this.firestore,
            'productos',
            first
          );

        const testSnap =
          await getDoc(testRef);

        if (testSnap.exists()) {

          productDocId = first;

        }
      }

      const productoRef =
        doc(
          this.firestore,
          'productos',
          productDocId
        );

      // =====================================================
      // TRANSACTION
      // =====================================================

      await runTransaction(
        this.firestore,
        async (tx) => {

          const prodSnap =
            await tx.get(productoRef);

          if (!prodSnap.exists()) {

            throw new Error(
              `Producto no encontrado: ${productDocId}`
            );

          }

          const productoData: any =
            prodSnap.data();

          // =================================================
          // TIPO DE STOCK
          // =================================================

          const stockDescontado =
            item.stockDescontado;

          // =================================================
          // HELPER MAP → ARRAY
          // =================================================

          const mapToArray = (maybeMap: any) => {

            if (!maybeMap) return [];

            if (Array.isArray(maybeMap)) {

              return maybeMap;

            }

            return Object.entries(maybeMap)
              .map(
                ([sucursalId, cantidad]) => ({
                  sucursalId,
                  cantidad:
                    Number(cantidad) || 0
                })
              );

          };

          // =================================================
          // BUSCAR VARIANTE
          // =================================================

          let varianteIndex = -1;

          let varianteObj: any = null;

          if (
            Array.isArray(productoData.variantes)
          ) {

            varianteIndex =
              productoData.variantes.findIndex(
                (v: any) =>
                  v.codigoBarras ===
                  item.codigoBarras
              );

            if (varianteIndex >= 0) {

              varianteObj =
                productoData.variantes[
                  varianteIndex
                ];

              varianteObj.stockSucursales =
                mapToArray(
                  varianteObj.stockSucursales
                );
            }
          }

          // =================================================
          // MAYORISTA
          // =================================================

          if (
            stockDescontado.tipo ===
            'mayorista'
          ) {

            const cantidad =
              Number(
                stockDescontado.cantidad
              ) || 0;

            if (cantidad <= 0) {

              console.warn(
                '⚠️ Cantidad mayorista inválida:',
                item
              );

              return;
            }

            // -----------------------------------------------
            // VARIANTE MAYORISTA
            // -----------------------------------------------

            if (varianteObj) {

              const stockActual =
                Number(
                  varianteObj.stockMayorista
                ) || 0;

              varianteObj.stockMayorista =
                stockActual + cantidad;

              productoData.variantes[
                varianteIndex
              ] = varianteObj;

              tx.update(
                productoRef,
                {
                  variantes:
                    productoData.variantes
                }
              );

            }

            // -----------------------------------------------
            // PRODUCTO NORMAL MAYORISTA
            // -----------------------------------------------

            else {

              const stockActual =
                Number(
                  productoData.stockMayorista
                ) || 0;

              productoData.stockMayorista =
                stockActual + cantidad;

              tx.update(
                productoRef,
                {
                  stockMayorista:
                    productoData.stockMayorista
                }
              );

            }

          }

          // =================================================
          // MINORISTA
          // =================================================

          else if (
            stockDescontado.tipo ===
            'minorista'
          ) {

            const devoluciones =
              stockDescontado.sucursales || [];

            // -----------------------------------------------
            // PREPARAR STOCK DE SUCURSALES
            // -----------------------------------------------

            if (varianteObj) {

              varianteObj.stockSucursales =
                mapToArray(
                  varianteObj.stockSucursales
                );

            } else {

              productoData.stockSucursales =
                mapToArray(
                  productoData.stockSucursales
                );

            }

            const sucursales =
              varianteObj
                ? varianteObj.stockSucursales
                : productoData.stockSucursales;

            // -----------------------------------------------
            // DEVOLVER A CADA SUCURSAL
            // -----------------------------------------------

            for (
              const devolucion
              of devoluciones
            ) {

              const sucursalId =
                devolucion.sucursalId;

              const cantidad =
                Number(
                  devolucion.cantidad
                ) || 0;

              if (
                !sucursalId ||
                cantidad <= 0
              ) {

                continue;

              }

              const sucursal =
                sucursales.find(
                  (s: any) =>
                    s.sucursalId ===
                    sucursalId
                );

              if (sucursal) {

                sucursal.cantidad =
                  (
                    Number(
                      sucursal.cantidad
                    ) || 0
                  ) + cantidad;

              }

              else {

                sucursales.push({
                  sucursalId,
                  cantidad
                });

              }

            }

            // -----------------------------------------------
            // GUARDAR
            // -----------------------------------------------

            if (varianteObj) {

              productoData.variantes[
                varianteIndex
              ] = varianteObj;

              tx.update(
                productoRef,
                {
                  variantes:
                    productoData.variantes
                }
              );

            }

            else {

              tx.update(
                productoRef,
                {
                  stockSucursales:
                    productoData.stockSucursales
                }
              );

            }

          }

        }
      );
    }
  }

}
