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
  sucursalId: string;            // de qué sucursal salió el stock
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

/** Artículos vigentes (no devueltos) */
export function articulosActivos(orden: any): ArticuloOrden[] {
  return (orden?.articulos || []).filter((a: ArticuloOrden) => !a.devuelto);
}

/**
 * Agrega / devuelve artículos de stock en las órdenes del taller.
 * Cada operación es UNA transacción: stock del producto + orden + auditoría.
 * NO modifica el presupuesto de la orden.
 */
@Injectable({ providedIn: 'root' })
export class ArticulosOrdenService {

  constructor(private firestore: Firestore, private auditoria: AuditoriaService) { }

  /** Descuenta `cantidad` del stock de la sucursal y lo registra en la orden */
  async agregar(
    orden: { id: string; coleccion: string; numeroOrden?: number },
    productoId: string,
    sucursalId: string,
    cantidad: number,
    nombreSucursal = ''
  ): Promise<{ articulo: ArticuloOrden; producto: any }> {
    const usuario = this.usuario();
    const cant = Math.floor(Number(cantidad) || 0);
    if (!(cant > 0)) throw new ArticuloOrdenError('La cantidad tiene que ser mayor a 0.');
    if (!sucursalId) throw new ArticuloOrdenError('Elegí la sucursal de donde sale el artículo.');

    const ordenRef = doc(this.firestore, orden.coleccion, orden.id);
    const productoRef = doc(this.firestore, 'productos', productoId);

    const registro = await this.auditoria.armarRegistro({
      accion: 'modificar',
      entidad: orden.coleccion,
      entidadId: orden.id,
      descripcion: '',
      extra: { productoId, sucursalId, cantidad: cant, operacion: 'articulo usado en reparacion' }
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
      const stock = normalizarStock(prod.stockSucursales);
      const entrada = stock.find(s => s.sucursalId === sucursalId);
      const disponible = entrada?.cantidad || 0;
      if (cant > disponible) {
        throw new ArticuloOrdenError(
          `No hay stock suficiente de "${prod.descripcion}" en ${nombreSucursal || 'esa sucursal'}: hay ${disponible}.`);
      }
      entrada!.cantidad = disponible - cant;

      articulo = {
        id: this.nuevoId(),
        productoId,
        nombre: prod.descripcion || prod.nombre || 'Producto',
        codigoBarras: prod.codigoBarras || null,
        cantidad: cant,
        sucursalId,
        costoUnitario: prod.precioCosto != null ? Number(prod.precioCosto) || 0 : null,
        fecha: new Date().toISOString(),
        usuario,
        devuelto: false
      };

      tx.update(productoRef, { stockSucursales: stock });
      tx.update(ordenRef, { articulos: [...(datosOrden.articulos || []), articulo] });

      if (registro) {
        registro.descripcion = `Usó ${cant} x ${articulo.nombre} en la orden #${datosOrden.numeroOrden ?? orden.numeroOrden ?? '?'}` +
          ` (stock ${nombreSucursal || sucursalId}: ${disponible} → ${disponible - cant})`;
      }
      this.auditoria.registrarEnTransaccion(tx, registro);
      productoActualizado = { ...prod, stockSucursales: stock };
    });

    return { articulo, producto: productoActualizado };
  }

  /** Devuelve el artículo al stock de la sucursal de donde salió y lo marca como devuelto */
  async devolver(
    orden: { id: string; coleccion: string; numeroOrden?: number },
    articuloId: string,
    motivo: string,
    nombreSucursal = ''
  ): Promise<{ producto: any | null }> {
    const res = await this.devolverVarios(orden, [articuloId], motivo, { [articuloId]: nombreSucursal });
    return { producto: res.productos[0] || null };
  }

  /**
   * Devuelve varios artículos (o todos los activos si `ids` es null) en una sola transacción.
   * Si el producto ya no existe, el artículo se marca devuelto igual y se informa.
   */
  async devolverVarios(
    orden: { id: string; coleccion: string; numeroOrden?: number },
    ids: string[] | null,
    motivo: string,
    nombresSucursal: { [id: string]: string } = {}
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
      }

      // Escrituras
      const ahora = new Date().toISOString();
      for (const a of aDevolver) {
        const prod = snaps.get(a.productoId);
        if (prod) {
          let entrada = prod.stockSucursales.find((s: any) => s.sucursalId === a.sucursalId);
          if (!entrada) {
            entrada = { sucursalId: a.sucursalId, cantidad: 0 };
            prod.stockSucursales.push(entrada);
          }
          entrada.cantidad += a.cantidad;
          devueltos.push(`${a.cantidad} x ${a.nombre}${nombresSucursal[a.id] ? ' (' + nombresSucursal[a.id] + ')' : ''}`);
        } else {
          sinProducto.push(a.nombre);
        }
        const i = articulos.findIndex(x => x.id === a.id);
        articulos[i] = { ...a, devuelto: true, devueltoEn: ahora, devueltoPor: usuario, motivoDevolucion: motivo || null };
      }
      for (const prod of snaps.values()) {
        if (!prod) continue;
        tx.update(doc(this.firestore, 'productos', prod.id), { stockSucursales: prod.stockSucursales });
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
