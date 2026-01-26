import { Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import { addDoc, collection, collectionData, deleteDoc, doc, Firestore, query, updateDoc, where } from '@angular/fire/firestore';
import { Producto } from '../models/producto.model';

@Injectable({
  providedIn: 'root'
})
export class ProductosService {

  constructor(private firestore: Firestore) { }

   obtenerProductos(): Observable<Producto[]> {
    const ref = collection(this.firestore, 'productos');
    return collectionData(ref, { idField: 'id' }) as Observable<Producto[]>;
  }

  agregarProducto(producto: Producto): Promise<any> {
    console.log('Producto a agregar:', producto);

    const ref = collection(this.firestore, 'productos');

    // Convertimos a objeto plano
    const productoPlano = {
      ...producto,
      stockSucursales: producto.stockSucursales || [] // asegurar que sea array simple
    };

    return addDoc(ref, productoPlano);
  }

  editarProducto(producto: Producto): Promise<void> {
    const productoRef = doc(this.firestore, `productos/${producto.id}`);
    return updateDoc(productoRef, { ...producto });
  }

  eliminarProducto(id: string): Promise<void> {
    const docRef = doc(this.firestore, 'productos', id);
    return deleteDoc(docRef);
  }

  obtenerDestacados(): Observable<Producto[]> {
    const ref = collection(this.firestore, 'productos');
    const q = query(ref, where('destacado', '==', true));
    return collectionData(q) as Observable<Producto[]>;
  }

  actualizarProducto(producto: Producto): Promise<void> {
    console.log('Producto a actualizar:', producto);
    const docRef = doc(this.firestore, 'productos', producto.id);
    return updateDoc(docRef, { ...producto });
  }


  obtenerProductosAgrupados(): Observable<Producto[]> {
    const ref = collection(this.firestore, 'productos');

    return collectionData(ref, { idField: 'id' }).pipe(
      map((productos: any[]) => {

        const agrupados: { [key: string]: any } = {};

        productos.forEach(p => {

          const clave = p.productoPadre || p.id;

          // 🔧 NORMALIZAMOS stockSucursales
          let stockSucursalesArray: any[] = [];

          if (p.stockSucursales) {
            if (Array.isArray(p.stockSucursales)) {
              stockSucursalesArray = p.stockSucursales;
            } else {
              stockSucursalesArray = Object.values(p.stockSucursales).map((cantidad: any) => ({
                cantidad
              }));
            }
          }

          // 🔢 stock minorista
          const stockTotal = stockSucursalesArray.reduce(
            (acc: number, s: any) => acc + (s.cantidad || 0),
            0
          );

          // 🧱 PRODUCTO PADRE
          if (!agrupados[clave]) {
            agrupados[clave] = {
              id: clave,
              productoPadre: p.productoPadre || null,
              nombre: p.nombre,
              descripcion: p.descripcion,
              rubro: p.rubro,
              subrubro: p.subrubro,
              marca: p.marca,
              imagen: p.imagen,
              codigoBarras: p.codigoBarras ?? null, // ✅ FIX
              destacado: p.destacado,
              oferta: p.oferta,
              precioOferta: p.precioOferta,
              precioMayorista: p.precioMayorista ?? null,
              precioMinorista: p.precioMinorista ?? null,
              ventaMayorista: p.ventaMayorista ?? true,
              ventaMinorista: p.ventaMinorista ?? true,
              stockMayorista: p.stockMayorista ?? 0,
              stockTotal,
              variantes: []
            };
          }

          // 🧬 VARIANTES
          if (p.productoPadre) {
            agrupados[clave].variantes.push({
              id: p.id,
              modelo: p.modelo || null,
              color: p.color || null,
              imagen: p.imagen || agrupados[clave].imagen,
              codigoBarras: p.codigoBarras ?? null, // ✅ FIX
              stockSucursales: stockSucursalesArray,
              stockTotal,
              stockMayorista: p.stockMayorista ?? 0,
              precioMinorista: p.precioMinorista,
              precioMayorista: p.precioMayorista,
              precioOferta: p.precioOferta,
              oferta: p.oferta
            });
          }
        });

        return Object.values(agrupados);
      })
    );
  }




  getProductoAgrupadoById(id: string): Observable<Producto | undefined> {
  return this.obtenerProductosAgrupados().pipe(
    map(productos =>
      productos.find(p => p.id === id || p.variantes?.some(v => v.id === id))
    )
  );
}


}
