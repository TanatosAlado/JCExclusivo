import { Injectable } from '@angular/core';
import { addDoc, collection, collectionData, deleteDoc, doc, Firestore, getDoc, runTransaction, setDoc, updateDoc } from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { Pedido } from 'src/app/modules/shop/models/pedido.model';
import { AuditoriaService } from 'src/app/shared/services/auditoria.service';

@Injectable({
  providedIn: 'root'
})
export class PedidosService {

  constructor(private firestore: Firestore, private auditoria: AuditoriaService) { }

  // =====================================================
  // 📱 EQUIPOS EN PEDIDOS WEB
  // Al hacer el pedido el equipo queda "vendido" (reservado para ese pedido).
  // Si el pedido se cancela (o se le quita el equipo), vuelve a estar a la venta.
  // =====================================================

  private esEquipo(item: any): boolean {
    return item?.tipo === 'equipo' && !!item?.equipoId;
  }

  /** Devuelve a la venta los equipos del pedido que siguen reservados por ESE pedido. Devuelve los nombres. */
  async devolverEquiposPedido(pedidoId: string, items: any[], motivo: string): Promise<string[]> {
    const equipos = (items || []).filter(i => this.esEquipo(i));
    if (!equipos.length) return [];
    const devueltos: string[] = [];

    await runTransaction(this.firestore, async tx => {
      devueltos.length = 0;
      const lecturas: { item: any; ref: any; data: any; imeiRef: any; imeiData: any }[] = [];
      for (const item of equipos) {
        const ref = doc(this.firestore, 'Equipos', item.equipoId);
        const snap = await tx.get(ref);
        const data: any = snap.exists() ? snap.data() : null;
        const imeiRef = data?.imei ? doc(this.firestore, 'EquiposIMEI', String(data.imei)) : null;
        const imeiSnap = imeiRef ? await tx.get(imeiRef) : null;
        lecturas.push({ item, ref, data, imeiRef, imeiData: imeiSnap?.exists() ? imeiSnap.data() : null });
      }
      for (const l of lecturas) {
        if (!l.data || l.data.estado !== 'vendido' || l.data.venta?.pedidoId !== pedidoId) continue;
        // Mientras tanto cargaron otro equipo disponible con el mismo IMEI: no puede haber dos
        if (l.imeiData && l.imeiData.equipoId !== l.item.equipoId) {
          throw new Error(`Ya hay otro equipo disponible con el IMEI ${l.data.imei}. Revisalo en Gestiones → Equipos.`);
        }
        tx.update(l.ref, {
          estado: 'disponible',
          venta: null,
          ventasAnuladas: [...(l.data.ventasAnuladas || []), {
            pedidoId,
            nroPedido: l.data.venta?.nroPedido ?? null,
            fecha: l.data.venta?.fecha ?? null,
            anuladaEn: new Date().toISOString(),
            motivo
          }]
        });
        if (l.imeiRef) tx.set(l.imeiRef, { equipoId: l.item.equipoId, modelo: l.data.modelo || '' });
        devueltos.push(l.item.nombre);
      }
    });
    return devueltos;
  }

  /** Vuelve a reservar los equipos de un pedido que se restaura (tienen que seguir disponibles) */
  private async reservarEquiposPedido(pedidoId: string, pedido: any): Promise<void> {
    const equipos = (pedido.carrito || []).filter((i: any) => this.esEquipo(i));
    if (!equipos.length) return;

    await runTransaction(this.firestore, async tx => {
      const lecturas: { item: any; ref: any; data: any; imeiRef: any; imeiData: any }[] = [];
      for (const item of equipos) {
        const ref = doc(this.firestore, 'Equipos', item.equipoId);
        const snap = await tx.get(ref);
        const data: any = snap.exists() ? snap.data() : null;
        const imeiRef = data?.imei ? doc(this.firestore, 'EquiposIMEI', String(data.imei)) : null;
        const imeiSnap = imeiRef ? await tx.get(imeiRef) : null;
        lecturas.push({ item, ref, data, imeiRef, imeiData: imeiSnap?.exists() ? imeiSnap.data() : null });
      }
      for (const l of lecturas) {
        // Ya está reservado por este mismo pedido: nada que hacer
        if (l.data?.estado === 'vendido' && l.data?.venta?.pedidoId === pedidoId) continue;
        if (!l.data || l.data.estado !== 'disponible') {
          throw new Error(`No se puede restaurar el pedido: el equipo "${l.item.nombre}" ya no está disponible.`);
        }
      }
      for (const l of lecturas) {
        if (l.data?.estado !== 'disponible') continue;
        tx.update(l.ref, {
          estado: 'vendido',
          venta: {
            ventaId: null,
            pedidoId,
            nroPedido: pedido.nroPedido ?? null,
            fecha: new Date().toISOString(),
            origen: 'web',
            cliente: { id: pedido.clienteId || null, nombre: pedido.nombreCliente || pedido.user || '' },
            precio: l.item.precioFinal ?? null,
            moneda: l.item.moneda ?? null
          }
        });
        if (l.imeiRef && l.imeiData?.equipoId === l.item.equipoId) tx.delete(l.imeiRef);
      }
    });
  }

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
      const antes = await this.auditoria.capturar(tabla, id);
      await deleteDoc(productoRef);
      this.auditoria.registrar({
        accion: 'eliminar',
        entidad: tabla,
        entidadId: id,
        descripcion: `Eliminó definitivamente el pedido #${antes?.nroPedido ?? '?'} de ${tabla}`,
        antes
      });
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
  async updateCarroEnPedido(idPedido: string, nuevoCarro: any[]) {
    // Un equipo es una unidad única: la cantidad siempre es 1
    nuevoCarro = (nuevoCarro || []).map(i => this.esEquipo(i) ? { ...i, cantidad: 1 } : i);
    const nuevoTotal = nuevoCarro.reduce((acc, item) => acc + item.precioFinal * item.cantidad, 0);
    const antes = await this.auditoria.capturar('Pedidos Pendientes', idPedido);
    // Equipos que se sacaron del pedido: vuelven a la venta
    const quitados = (antes?.carrito || []).filter((i: any) => this.esEquipo(i) && !nuevoCarro.some(n => n.equipoId === i.equipoId));
    if (quitados.length) await this.devolverEquiposPedido(idPedido, quitados, `Quitado del pedido #${antes?.nroPedido ?? '?'}`);
    const pedidoRef = doc(this.firestore, 'Pedidos Pendientes', idPedido);
    await updateDoc(pedidoRef, {
      carrito: nuevoCarro,
      total: nuevoTotal
    });
    this.auditoria.registrar({
      accion: 'modificar',
      entidad: 'Pedidos Pendientes',
      entidadId: idPedido,
      descripcion: `Modificó los productos del pedido #${antes?.nroPedido ?? '?'}`,
      antes: { total: antes?.total, productos: this.resumenCarrito(antes?.carrito) },
      despues: { total: nuevoTotal, productos: this.resumenCarrito(nuevoCarro) }
    });
  }

  /** "2 x Funda, 1 x Cargador" para la auditoría */
  private resumenCarrito(carrito: any[] | undefined): string {
    return (carrito || []).map(i => `${i.cantidad} x ${i.nombre}`).join(', ');
  }

    deleteProductoDelCarrito(idPedido: string, idProducto: string) {
    const pedidoRef = doc(this.firestore, 'Pedidos Pendientes', idPedido);

    return getDoc(pedidoRef).then(async (docSnap) => {
      if (!docSnap.exists()) {
        throw new Error('Pedido no encontrado');
      }
      const pedidoData = docSnap.data();
      const quitado = (pedidoData['carrito'] || []).find((p: any) => p.id === idProducto);
      // 📱 Si es un equipo, vuelve a estar a la venta
      if (this.esEquipo(quitado)) {
        await this.devolverEquiposPedido(idPedido, [quitado], `Quitado del pedido #${pedidoData['nroPedido'] ?? '?'}`);
      }
      this.auditoria.registrar({
        accion: 'modificar',
        entidad: 'Pedidos Pendientes',
        entidadId: idPedido,
        descripcion: `Quitó "${quitado?.nombre || idProducto}" del pedido #${pedidoData['nroPedido'] ?? '?'}`
      });
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

        // 📱 Equipos: vuelven a la venta (una sola vez)
        if (data.equiposDevueltos !== true) {
          const devueltos = await this.devolverEquiposPedido(id, data.carrito || [], `Pedido #${data.nroPedido ?? '?'} eliminado`);
          data.equiposDevueltos = true;
          if (devueltos.length) data.equiposDevueltosNombres = devueltos;
        }

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

      // 📱 Pedido eliminado que se restaura: los equipos se vuelven a reservar (tienen que seguir disponibles)
      if (origen === 'Pedidos Eliminados' && destino === 'Pedidos Pendientes'
        && (data.carrito || []).some((i: any) => this.esEquipo(i))) {
        await this.reservarEquiposPedido(id, data);
        data.equiposDevueltos = false;
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

      this.auditoria.registrar({
        accion: 'mover',
        entidad: origen,
        entidadId: id,
        descripcion: `Pasó el pedido #${data.nroPedido ?? '?'} de "${origen}" a "${destino}"` +
          (data.stockDevuelto === true && destino === 'Pedidos Eliminados' ? ' (stock devuelto)' : ''),
        extra: { origen, destino, total: data.total ?? null, cliente: data.nombreCliente ?? null }
      });


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
