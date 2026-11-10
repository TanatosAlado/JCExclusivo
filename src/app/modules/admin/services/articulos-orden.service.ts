import { Injectable } from '@angular/core';
import { Firestore, doc, runTransaction } from '@angular/fire/firestore';
import { AuditoriaService, UsuarioRegistro } from 'src/app/shared/services/auditoria.service';

/**
 * Artículo de nuestro stock usado en una orden de reparación.
 * No se borra nunca: si se devuelve al stock queda marcado como devuelto (trazabilidad).
 */
export interface ArticuloOrden {
  id: string;                    // id propio dentro de la orden
  productoId: string;
  nombre: string;
  codigoBarras?: string | null;
  cantidad: number;
  origen?: 'mayorista' | 'sucursal'; // de qué stock salió (el taller usa el stock MAYORISTA)
  sucursalId?: string | null;    // solo si salió del stock de una sucursal (cargas viejas)
  costoUnitario: number | null;  // informativo (precio de costo al momento de usarlo)
  fecha: string;                 // ISO
  usuario: UsuarioRegistro;
  devuelto?: boolean;
  devueltoEn?: string | null;
  devueltoPor?: UsuarioRegistro | null;
  motivoDevolucion?: string | null;
}

export class ArticuloOrdenError extends Error {
  constructor(message: string) {
    super(message);
  }
}

/** Normaliza stockSucursales (estructura vieja tipo mapa → array) */
export function normalizarStock(stock: any): { sucursalId: string; cantidad: number }[] {
  if (!stock) return [];
  if (Array.isArray(stock)) {
    return stock.map((s: any) => ({ sucursalId: s.sucursalId, cantidad: Number(s.cantidad) || 0 }));
  }
  return Object.entries(stock).map(([sucursalId, cantidad]) => ({ sucursalId, cantidad: Number(cantidad) || 0 }));
}

export function stockEnSucursal(producto: any, sucursalId: string): number {
  return normalizarStock(producto?.stockSucursales).find(s => s.sucursalId === sucursalId)?.cantidad || 0;
}

/** Stock mayorista (está en el local donde se hacen las reparaciones) */
export function stockMayorista(producto: any): number {
  return Math.max(0, Number(producto?.stockMayorista) || 0);
}

/** Si el artículo salió del stock mayorista (las cargas sin sucursal también) */
export function esDeMayorista(a: ArticuloOrden): boolean {
  return a.origen === 'mayorista' || !a.sucursalId;
}

/** Artículos vigentes (no devueltos) */
export function articulosActivos(orden: any): ArticuloOrden[] {
  return (orden?.articulos || []).filter((a: ArticuloOrden) => !a.devuelto);
}

/**
 * Agrega / devuelve artículos de stock en las órdenes del taller.
 * Los repuestos salen del STOCK MAYORISTA (está en el local donde se repara).
 * Una orden puede tener varios artículos.
 * Cada operación es UNA transacción: stock del producto + orden + auditoría.
 * NO modifica el presupuesto de la orden.
 */
@Injectable({ providedIn: 'root' })
export class ArticulosOrdenService {

  constructor(private firestore: Firestore, private auditoria: AuditoriaService) { }

  /** Descuenta `cantidad` del stock mayorista y lo registra en la orden */
  async agregar(
    orden: { id: string; coleccion: string; numeroOrden?: number },
    productoId: string,
    cantidad: number
  ): Promise<{ articulo: ArticuloOrden; producto: any }> {
    const usuario = this.usuario();
    const cant = Math.floor(Number(cantidad) || 0);
    if (!(cant > 0)) throw new ArticuloOrdenError('La cantidad tiene que ser mayor a 0.');

    const ordenRef = doc(this.firestore, orden.coleccion, orden.id);
    const productoRef = doc(this.firestore, 'productos', productoId);

    const registro = await this.auditoria.armarRegistro({
      accion: 'modificar',
      entidad: orden.coleccion,
      entidadId: orden.id,
      descripcion: '',
      extra: { productoId, cantidad: cant, origen: 'mayorista', operacion: 'articulo usado en reparacion' }
    });

    let articulo!: ArticuloOrden;
    let productoActualizado: any;

    await runTransaction(this.firestore, async (tx) => {
      const ordenSnap = await tx.get(ordenRef);
      const prodSnap = await tx.get(productoRef);
      if (!ordenSnap.exists()) throw new ArticuloOrdenError('La orden ya no existe en ' + orden.coleccion + '.');
      if (!prodSnap.exists()) throw new ArticuloOrdenError('El producto ya no existe.');

      const datosOrden: any = ordenSnap.data();
      const prod: any = { id: prodSnap.id, ...prodSnap.data() };
      const disponible = stockMayorista(prod);
      if (cant > disponible) {
        throw new ArticuloOrdenError(
          `No hay stock mayorista suficiente de "${prod.descripcion}": hay ${disponible}.`);
      }
      const nuevoStock = disponible - cant;

      articulo = {
        id: this.nuevoId(),
        productoId,
        nombre: prod.descripcion || prod.nombre || 'Producto',
        codigoBarras: prod.codigoBarras || null,
        cantidad: cant,
        origen: 'mayorista',
        sucursalId: null,
        costoUnitario: prod.precioCosto != null ? Number(prod.precioCosto) || 0 : null,
        fecha: new Date().toISOString(),
        usuario,
        devuelto: false
      };

      tx.update(productoRef, { stockMayorista: nuevoStock });
      tx.update(ordenRef, { articulos: [...(datosOrden.articulos || []), articulo] });

      if (registro) {
        registro.descripcion = `Usó ${cant} x ${articulo.nombre} en la orden #${datosOrden.numeroOrden ?? orden.numeroOrden ?? '?'}` +
          ` (stock mayorista: ${disponible} → ${nuevoStock})`;
      }
      this.auditoria.registrarEnTransaccion(tx, registro);
      productoActualizado = { ...prod, stockMayorista: nuevoStock };
    });

    return { articulo, producto: productoActualizado };
  }

  /** Devuelve el artículo al stock de donde salió (mayorista) y lo marca como devuelto */
  async devolver(
    orden: { id: string; coleccion: string; numeroOrden?: number },
    articuloId: string,
    motivo: string
  ): Promise<{ producto: any | null }> {
    const res = await this.devolverVarios(orden, [articuloId], motivo);
    return { producto: res.productos[0] || null };
  }

  /**
   * Devuelve varios artículos (o todos los activos si `ids` es null) en una sola transacción.
   * Si el producto ya no existe, el artículo se marca devuelto igual y se informa.
   */
  async devolverVarios(
    orden: { id: string; coleccion: string; numeroOrden?: number },
    ids: string[] | null,
    motivo: string
  ): Promise<{ devueltos: string[]; sinProducto: string[]; productos: any[] }> {
    const usuario = this.usuario();
    const ordenRef = doc(this.firestore, orden.coleccion, orden.id);
    const registro = await this.auditoria.armarRegistro({
      accion: 'modificar',
      entidad: orden.coleccion,
      entidadId: orden.id,
      descripcion: '',
      extra: { operacion: 'devolucion de articulos al stock', motivo }
    });

    const devueltos: string[] = [];
    const sinProducto: string[] = [];
    const productos: any[] = [];

    await runTransaction(this.firestore, async (tx) => {
      devueltos.length = 0; sinProducto.length = 0; productos.length = 0;

      const ordenSnap = await tx.get(ordenRef);
      if (!ordenSnap.exists()) throw new ArticuloOrdenError('La orden ya no existe en ' + orden.coleccion + '.');
      const datosOrden: any = ordenSnap.data();
      const articulos: ArticuloOrden[] = [...(datosOrden.articulos || [])];

      const aDevolver = articulos.filter(a => !a.devuelto && (ids === null || ids.includes(a.id)));
      if (!aDevolver.length) {
        if (ids !== null) throw new ArticuloOrdenError('Ese artículo ya fue devuelto.');
        return;
      }

      // Lecturas: un producto puede repetirse → se lee una vez
      const idsProd = [...new Set(aDevolver.map(a => a.productoId))];
      const snaps = new Map<string, any>();
      for (const pid of idsProd) {
        const s = await tx.get(doc(this.firestore, 'productos', pid));
        snaps.set(pid, s.exists() ? { id: s.id, ...s.data(), stockSucursales: normalizarStock((s.data() as any).stockSucursales) } : null);
        if (snaps.get(pid)) snaps.get(pid).__cambios = new Set<string>();
      }

      // Escrituras
      const ahora = new Date().toISOString();
      for (const a of aDevolver) {
        const prod = snaps.get(a.productoId);
        if (prod) {
          if (esDeMayorista(a)) {
            prod.stockMayorista = stockMayorista(prod) + a.cantidad;
            prod.__cambios.add('stockMayorista');
          } else {
            // Cargas viejas: salió del stock de una sucursal → vuelve ahí
            let entrada = prod.stockSucursales.find((s: any) => s.sucursalId === a.sucursalId);
            if (!entrada) {
              entrada = { sucursalId: a.sucursalId, cantidad: 0 };
              prod.stockSucursales.push(entrada);
            }
            entrada.cantidad += a.cantidad;
            prod.__cambios.add('stockSucursales');
          }
          devueltos.push(`${a.cantidad} x ${a.nombre}`);
        } else {
          sinProducto.push(a.nombre);
        }
        const i = articulos.findIndex(x => x.id === a.id);
        articulos[i] = { ...a, devuelto: true, devueltoEn: ahora, devueltoPor: usuario, motivoDevolucion: motivo || null };
      }
      for (const prod of snaps.values()) {
        if (!prod) continue;
        const cambios: any = {};
        for (const campo of prod.__cambios) cambios[campo] = prod[campo];
        delete prod.__cambios;
        tx.update(doc(this.firestore, 'productos', prod.id), cambios);
        productos.push(prod);
      }
      tx.update(ordenRef, { articulos });

      if (registro) {
        registro.descripcion = `Devolvió al stock artículos de la orden #${datosOrden.numeroOrden ?? orden.numeroOrden ?? '?'}: ` +
          `${[...devueltos, ...sinProducto.map(n => n + ' (producto inexistente)')].join(', ')}. Motivo: ${motivo || '-'}`;
      }
      this.auditoria.registrarEnTransaccion(tx, registro);
    });

    return { devueltos, sinProducto, productos };
  }

  private usuario(): UsuarioRegistro {
    const u = this.auditoria.getUsuarioActual();
    if (!u) throw new ArticuloOrdenError('No se pudo identificar al usuario. Volvé a iniciar sesión.');
    return u;
  }

  private nuevoId(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
}
