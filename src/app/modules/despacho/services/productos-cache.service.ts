import { Injectable } from '@angular/core';
import { Firestore, collection, getDocs } from '@angular/fire/firestore';
import { openDB } from 'idb';
import { Producto, VarianteProducto } from '../../shop/models/producto.model';

@Injectable({
  providedIn: 'root'
})
export class ProductosCacheService {

  private dbPromise: Promise<any>;

  constructor(private firestore: Firestore) {
    this.dbPromise = openDB('productosDB', 1, {
      upgrade(db) {
        db.createObjectStore('productos', { keyPath: 'id' });
      }
    });
  }

  // 🔹 Descargar productos de Firebase y guardarlos en IndexedDB
  async syncProductos() {

    const productosRef = collection(this.firestore, 'productos');
    const snapshot = await getDocs(productosRef);

    const productos = snapshot.docs.map(d => {

      const producto: any = {
        id: d.id,
        ...d.data()
      };

      // ✅ Compatibilidad con estructura vieja
      if (
        producto.stockSucursales &&
        !Array.isArray(producto.stockSucursales)
      ) {
        producto.stockSucursales = Object.keys(producto.stockSucursales).map(key => ({
          sucursalId: key,
          cantidad: producto.stockSucursales[key] || 0
        }));
      }

      return producto;

    });

    const db = await this.dbPromise;

    const tx = db.transaction('productos', 'readwrite');

    // =====================================================
    // 1️⃣ IDs que existen actualmente en Firestore
    // =====================================================

    const idsFirestore = new Set(
      productos.map(p => p.id)
    );

    // =====================================================
    // 2️⃣ Obtener todos los productos actuales de IndexedDB
    // =====================================================

    const productosCache = await tx.store.getAll();

    // =====================================================
    // 3️⃣ Eliminar de IndexedDB los que ya no existen
    //    en Firestore
    // =====================================================

    for (const productoCache of productosCache) {

      if (!idsFirestore.has(productoCache.id)) {

        await tx.store.delete(
          productoCache.id
        );

      }
    }

    // =====================================================
    // 4️⃣ Guardar / actualizar productos actuales
    // =====================================================

    for (const p of productos) {

      await tx.store.put(p);

    }

    // =====================================================
    // 5️⃣ Confirmar transacción
    // =====================================================

    await tx.done;

    return productos;
  }

  // 🔹 Obtener todos los productos desde IndexedDB
  async getProductos() {
    const db = await this.dbPromise;
    return await db.getAll('productos');
  }

  // 🔹 Buscar por código de barras localmente
  async getProductoPorCodigo(codigo: string) {
    const productos = await this.getProductos();
    return productos.find((p: any) => p.codigoBarras === codigo) || null;
  }

  // 🔹 Buscar por descripción localmente
  async buscarProductos(termino: string) {
    termino = termino.toLowerCase();
    const productos = await this.getProductos();
    return productos.filter((p: any) =>
      p.descripcion.toLowerCase().includes(termino)
    );
  }

  async actualizarProducto(
    producto: Producto | VarianteProducto
  ): Promise<void> {

    const db = await this.dbPromise;

    await db.put(
      'productos',
      producto
    );
  }

  async eliminarProducto(id: string): Promise<void> {
    const db = await this.dbPromise;
    await db.delete('productos', id);
  }


}