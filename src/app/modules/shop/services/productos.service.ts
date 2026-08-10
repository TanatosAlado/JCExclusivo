import { Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import { addDoc, collection, collectionData, deleteDoc, doc, Firestore, getDocs, query, setDoc, updateDoc, where } from '@angular/fire/firestore';
import { Producto, StockSucursal, VarianteProducto } from '../models/producto.model';
import { ProductosCacheService } from '../../despacho/services/productos-cache.service';

@Injectable({
  providedIn: 'root'
})
export class ProductosService {

  constructor(private firestore: Firestore, private productosCache: ProductosCacheService) { }

   obtenerProductos(): Observable<Producto[]> {
    const ref = collection(this.firestore, 'productos');
    return collectionData(ref, { idField: 'id' }) as Observable<Producto[]>;
  }

  agregarProducto(producto: Producto): Promise<any> {

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

  async actualizarProducto(producto: Producto): Promise<void> {

    // =====================================================
    // 1️⃣ ACTUALIZAR EL DOCUMENTO ACTUAL
    // =====================================================

    const productoRef = doc(
      this.firestore,
      'productos',
      producto.id
    );

    const datosProducto = {
      codigoBarras: producto.codigoBarras || '',
      descripcion: producto.descripcion || '',
      subdescripcion: producto.subdescripcion || '',

      precioCosto: producto.precioCosto ?? 0,
      precioSinImpuestos: producto.precioSinImpuestos ?? 0,

      ventaMinorista: producto.ventaMinorista ?? false,
      precioMinorista: producto.precioMinorista ?? 0,

      ventaMayorista: producto.ventaMayorista ?? false,
      precioMayorista: producto.precioMayorista ?? 0,

      moneda: producto.moneda || 'ARS',

      imagen: producto.imagen || '',

      rubro: producto.rubro || '',
      subrubro: producto.subrubro || '',
      marca: producto.marca || '',

      destacado: producto.destacado ?? false,

      oferta: producto.oferta ?? false,
      precioOferta: producto.oferta
        ? producto.precioOferta ?? 0
        : null,

      stockMinimo: producto.stockMinimo ?? 0,

      stockMayorista: producto.stockMayorista ?? 0,

      stockSucursales:
        producto.stockSucursales || [],

      // IMPORTANTE:
      // mantenemos la relación con el padre
      productoPadre:
        producto.productoPadre || null,

      tipoVariantes:
        producto.tipoVariantes || 'none'
    };

    await updateDoc(
      productoRef,
      datosProducto
    );

    // =====================================================
    // 2️⃣ SI NO ES UN PRODUCTO CON VARIANTES,
    //    TERMINAMOS
    // =====================================================

    if (
      !producto.productoPadre ||
      !producto.variantes
    ) {

      await this.productosCache.actualizarProducto(producto);

      return;
    }


    // =====================================================
    // 3️⃣ OBTENER VARIANTES ACTUALES DE FIRESTORE
    // =====================================================

    const variantesFirestore =
      await this.obtenerVariantesPorProductoPadre(
        producto.productoPadre
      );


    // =====================================================
    // 4️⃣ ACTUALIZAR / CREAR VARIANTES
    // =====================================================

    for (const variante of producto.variantes) {

      // ---------------------------------------------------
      // ✏️ VARIANTE EXISTENTE
      // ---------------------------------------------------

      if (variante.id) {

        const varianteRef = doc(
          this.firestore,
          'productos',
          variante.id
        );

        await updateDoc(
          varianteRef,
          {
            modelo: variante.modelo || null,

            color: variante.color || null,

            codigoBarras:
              variante.codigoBarras || '',

            precioCosto:
              variante.precioCosto ??
              producto.precioCosto ??
              0,

            precioMinorista:
              variante.precioMinorista ??
              producto.precioMinorista ??
              0,

            precioMayorista:
              variante.precioMayorista ??
              producto.precioMayorista ??
              0,

            moneda:
              variante.moneda ??
              producto.moneda ??
              'ARS',

            imagen:
              variante.imagen ||
              producto.imagen ||
              '',

            stockMayorista:
              Number(variante.stockMayorista) || 0,

            stockSucursales:
              variante.stockSucursales || []
          }
        );
        await this.productosCache.actualizarProducto(variante);

      }

      // ---------------------------------------------------
      // 🆕 VARIANTE NUEVA
      // ---------------------------------------------------

      else {

        const productosRef =
          collection(
            this.firestore,
            'productos'
          );

        const nuevaVariante = {

          productoPadre:
            producto.productoPadre,

          nombre:
            `${producto.descripcion} - ${variante.color || ''}`.trim(),

          descripcion:
            producto.descripcion || '',

          subdescripcion:
            producto.subdescripcion || '',

          modelo:
            variante.modelo || null,

          color:
            variante.color || null,

          codigoBarras:
            variante.codigoBarras || '',

          precioCosto:
            variante.precioCosto ??
            producto.precioCosto ??
            0,

          precioSinImpuestos:
            producto.precioSinImpuestos ?? 0,

          precioMinorista:
            variante.precioMinorista ??
            producto.precioMinorista ??
            0,

          precioMayorista:
            variante.precioMayorista ??
            producto.precioMayorista ??
            0,

          moneda:
            variante.moneda ??
            producto.moneda ??
            'ARS',

          ventaMinorista:
            producto.ventaMinorista ?? false,

          ventaMayorista:
            producto.ventaMayorista ?? false,

          oferta:
            producto.oferta ?? false,

          precioOferta:
            producto.oferta
              ? producto.precioOferta ?? 0
              : null,

          destacado:
            producto.destacado ?? false,

          imagen:
            variante.imagen ||
            producto.imagen ||
            '',

          rubro:
            producto.rubro || '',

          subrubro:
            producto.subrubro || '',

          marca:
            producto.marca || '',

          stockMayorista:
            Number(variante.stockMayorista) || 0,

          stockSucursales:
            variante.stockSucursales || [],

          tipoVariantes:
            producto.tipoVariantes || 'color',

          fechaAlta:
            new Date()
        };

        const nuevaRef =
          await addDoc(
            productosRef,
            nuevaVariante
          );

        await updateDoc(
          nuevaRef,
          {
            id: nuevaRef.id
          }
        );

        // 💾 Agregamos el ID generado por Firebase
        const varianteNuevaCache = {
          ...nuevaVariante,
          id: nuevaRef.id
        };

        await this.productosCache.actualizarProducto(
          varianteNuevaCache
        );

        console.log(
          '🆕 Nueva variante creada:',
          nuevaRef.id
        );
      }
    }


    // =====================================================
    // 5️⃣ ELIMINAR VARIANTES
    // =====================================================

    const idsFormulario = new Set(
      producto.variantes
        .filter(v => !!v.id)
        .map(v => v.id)
    );

    for (const varianteFirestore of variantesFirestore) {

      if (
        varianteFirestore.id &&
        !idsFormulario.has(varianteFirestore.id)
      ) {

        await deleteDoc(
          doc(
            this.firestore,
            'productos',
            varianteFirestore.id
          )
        );

        // 🗑️ Eliminar también de IndexedDB
        await this.productosCache.eliminarProducto(
          varianteFirestore.id
        );

      }
    }


    // =====================================================
    // 6️⃣ CACHE
    // =====================================================

    await this.productosCache.actualizarProducto(
      producto
    );
  }


  actualizarStockProducto(
      id: string,
      stockSucursales: StockSucursal[],
      stockMayorista: number
  ): Promise<void> {

      const docRef = doc(this.firestore, 'productos', id);

      return updateDoc(docRef, {
          stockSucursales,
          stockMayorista
      });

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
              stockSucursalesArray = Object.entries(p.stockSucursales).map(
                ([sucursalId, cantidad]: any) => ({
                  sucursalId,
                  cantidad: Number(cantidad) || 0
                })
              );
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
              codigoBarras: p.codigoBarras ?? null, 
              moneda: p.moneda || 'ARS',
              destacado: p.destacado,
              oferta: p.oferta,
              precioOferta: p.precioOferta,
              precioMayorista: p.precioMayorista ?? null,
              precioMinorista: p.precioMinorista ?? null,
              ventaMayorista: p.ventaMayorista ?? true,
              ventaMinorista: p.ventaMinorista ?? true,
              stockMayorista: p.stockMayorista ?? 0,
              tipoVariantes: p.tipoVariantes || 'none',
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
              codigoBarras: p.codigoBarras ?? null,
              moneda: p.moneda || 'ARS',
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

        Object.values(agrupados).forEach((producto: any) => {

          // Si tiene variantes, el stock del padre es la suma
          if (producto.variantes.length > 0) {

            producto.stockTotal = producto.variantes.reduce(
              (acc: number, variante: any) => acc + (variante.stockTotal || 0),
              0
            );

            producto.stockMayorista = producto.variantes.reduce(
              (acc: number, variante: any) => acc + (variante.stockMayorista || 0),
              0
            );

          }

          producto.stockGlobal =
            (producto.stockTotal || 0) +
            (producto.stockMayorista || 0);

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

  async obtenerVariantesPorProductoPadre(productoPadre: string): Promise<VarianteProducto[]> {

    const productosRef = collection(this.firestore, 'productos');

    const consulta = query(
      productosRef,
      where('productoPadre', '==', productoPadre)
    );

    const snapshot = await getDocs(consulta);

    return snapshot.docs.map(doc => {

      const data = doc.data() as any;

      return {
        id: doc.id,
        modelo: data.modelo || null,
        color: data.color || null,
        codigoBarras: data.codigoBarras || '',
        precioCosto: data.precioCosto || 0,
        precioMinorista: data.precioMinorista || 0,
        precioMayorista: data.precioMayorista || 0,
        moneda: data.moneda || 'ARS',
        stockMayorista: data.stockMayorista || 0,
        stockSucursales: data.stockSucursales || [],
        imagen: data.imagen || ''
      };

    });

  }

    private async sincronizarVariantes(producto: Producto): Promise<void> {

    if (!producto.productoPadre) {
      console.warn('⚠️ El producto no tiene productoPadre');
      return;
    }

    const productosRef = collection(this.firestore, 'productos');

    const consulta = query(
      productosRef,
      where('productoPadre', '==', producto.productoPadre)
    );

    const snapshot = await getDocs(consulta);

    // Variantes que existen actualmente en Firestore
    const variantesFirestore = snapshot.docs.map(docSnap => ({
      id: docSnap.id,
      data: docSnap.data()
    }));

    // Variantes que quedaron en el formulario
    const variantesFormulario = producto.variantes || [];

    /*
    * ============================================================
    * 1️⃣ ACTUALIZAR VARIANTES EXISTENTES
    * ============================================================
    */

    for (const variante of variantesFormulario) {

      if (!variante.id) {
        continue;
      }

      const varianteRef = doc(
        this.firestore,
        'productos',
        variante.id
      );

      await updateDoc(varianteRef, {

        modelo: variante.modelo || null,
        color: variante.color || null,
        codigoBarras: variante.codigoBarras || '',
        imagen: variante.imagen || null,

        precioCosto: variante.precioCosto ?? 0,
        precioMinorista: variante.precioMinorista ?? 0,
        precioMayorista: variante.precioMayorista ?? 0,
        moneda: variante.moneda || producto.moneda || 'ARS',

        stockMayorista: Number(variante.stockMayorista) || 0,

        stockSucursales: variante.stockSucursales || [],

        productoPadre: producto.productoPadre,
        tipoVariantes: producto.tipoVariantes || 'color'

      });

      console.log(
        '✏️ Variante actualizada:',
        variante.id
      );
    }


    /*
    * ============================================================
    * 2️⃣ CREAR VARIANTES NUEVAS
    * ============================================================
    */

    for (const variante of variantesFormulario) {

      if (variante.id) {
        continue;
      }

      const nuevaVarianteRef = doc(
        collection(this.firestore, 'productos')
      );

      await setDoc(nuevaVarianteRef, {

        id: nuevaVarianteRef.id,

        codigoBarras: variante.codigoBarras || '',
        modelo: variante.modelo || null,
        color: variante.color || null,
        imagen: variante.imagen || null,

        precioCosto: variante.precioCosto ?? 0,
        precioMinorista: variante.precioMinorista ?? 0,
        precioMayorista: variante.precioMayorista ?? 0,
        moneda: variante.moneda || producto.moneda || 'ARS',

        stockMayorista: Number(variante.stockMayorista) || 0,

        stockSucursales: variante.stockSucursales || [],

        productoPadre: producto.productoPadre,
        tipoVariantes: producto.tipoVariantes || 'color',

        descripcion: producto.descripcion,
        subdescripcion: producto.subdescripcion,
        rubro: producto.rubro,
        subrubro: producto.subrubro,
        marca: producto.marca,

        ventaMinorista: producto.ventaMinorista,
        ventaMayorista: producto.ventaMayorista,

        destacado: producto.destacado,
        oferta: producto.oferta,

        precioSinImpuestos: producto.precioSinImpuestos,
        stockMinimo: producto.stockMinimo

      });

      console.log(
        '🆕 Nueva variante creada:',
        nuevaVarianteRef.id
      );
    }


    /*
    * ============================================================
    * 3️⃣ ELIMINAR VARIANTES QUE YA NO ESTÁN
    * ============================================================
    */

    const idsFormulario = new Set(
      variantesFormulario
        .filter(v => v.id)
        .map(v => v.id!)
    );

    for (const varianteFirestore of variantesFirestore) {

      if (!idsFormulario.has(varianteFirestore.id)) {

        const varianteRef = doc(
          this.firestore,
          'productos',
          varianteFirestore.id
        );

        await deleteDoc(varianteRef);

        console.log(
          '🗑️ Variante eliminada:',
          varianteFirestore.id
        );
      }
    }
  }


}
