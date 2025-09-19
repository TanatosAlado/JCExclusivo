import { Injectable } from '@angular/core';
import { Firestore, collection, getDocs } from '@angular/fire/firestore';
import { openDB } from 'idb';

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
    const productos = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

    const db = await this.dbPromise;
    const tx = db.transaction('productos', 'readwrite');
    for (const p of productos) {
      await tx.store.put(p);
    }
    await tx.done;

    console.log(`✅ Sincronizados ${productos.length} productos en IndexedDB`);
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
}