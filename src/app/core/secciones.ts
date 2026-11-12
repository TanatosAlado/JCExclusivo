/**
 * Secciones del panel a las que se les puede dar o quitar permiso por usuario.
 * Es la única fuente de verdad: la usan el menú de Gestiones, las rutas (PermisoGuard),
 * la navbar y la pantalla de Permisos.
 *
 * IMPORTANTE: si cambia PERMISOS_POR_DEFECTO, actualizar la misma lista en firestore.rules
 * (función permisosActuales()).
 */

export interface Seccion {
  clave: string;
  titulo: string;
  ruta: string;
  descripcion: string;
}

export const SECCIONES: Seccion[] = [
  { clave: 'despacho', titulo: 'Despacho', ruta: '/despacho', descripcion: 'Vender en el local, caja y cobro de reparaciones' },
  { clave: 'dashboard', titulo: 'Dashboard', ruta: '/gestiones/dashboard', descripcion: 'Indicadores y reporte Excel' },
  { clave: 'clientes', titulo: 'Clientes', ruta: '/gestiones/clientes', descripcion: 'Gestión de clientes' },
  { clave: 'equipos', titulo: 'Equipos', ruta: '/gestiones/equipos', descripcion: 'Alta, baja y modificación de equipos para la venta' },
  { clave: 'tasador', titulo: 'Tasador', ruta: '/gestiones/tasador', descripcion: 'Modelos, precios y preguntas para tasar equipos usados' },
  { clave: 'productos', titulo: 'Productos', ruta: '/gestiones/productos', descripcion: 'Gestión de productos y stock' },
  { clave: 'pedidos', titulo: 'Pedidos', ruta: '/gestiones/pedidos', descripcion: 'Pedidos de la tienda online' },
  { clave: 'taller', titulo: 'Taller', ruta: '/gestiones/taller', descripcion: 'Órdenes de reparación' },
  { clave: 'gifts', titulo: 'Vouchers y membresía', ruta: '/gestiones/gifts', descripcion: 'Cupones y puntos' },
  { clave: 'empresa', titulo: 'Información de la empresa', ruta: '/gestiones/empresa', descripcion: 'Datos, dólar y descuentos' },
  { clave: 'banner', titulo: 'Banner', ruta: '/gestiones/banner', descripcion: 'Imágenes de la tienda' },
  { clave: 'caja', titulo: 'Caja', ruta: '/gestiones/caja', descripcion: 'Libro diario, gastos y cajas' },
  { clave: 'cuentas', titulo: 'Cuentas corrientes', ruta: '/gestiones/cuentas-corrientes', descripcion: 'Saldos y movimientos de las cuentas de clientes' },
  { clave: 'cajeros', titulo: 'Cajeros', ruta: '/gestiones/cajeros', descripcion: 'Alta y baja de cajeros' },
  { clave: 'sucursales', titulo: 'Sucursales', ruta: '/gestiones/sucursales', descripcion: 'Gestión de sucursales' },
  { clave: 'marquesina', titulo: 'Marquesina', ruta: '/gestiones/marquesina', descripcion: 'Mensajes de la tienda' },
  { clave: 'tickets', titulo: 'Tickets', ruta: '/gestiones/tickets', descripcion: 'Buscar, reimprimir y anular tickets' },
  { clave: 'auditoria', titulo: 'Auditoría', ruta: '/gestiones/auditoria', descripcion: 'Registro de acciones de los usuarios' }
];

/** Exclusivas: un admin sin permisos cargados NO las ve (antes eran solo del superadmin) */
export const SECCIONES_EXCLUSIVAS = ['dashboard', 'gifts', 'empresa', 'banner', 'auditoria', 'marquesina', 'cuentas', 'equipos', 'tasador'];

/** Lo que ve un admin que todavía no tiene permisos cargados (= lo que veía antes de este cambio) */
export const PERMISOS_POR_DEFECTO = SECCIONES
  .map(s => s.clave)
  .filter(c => !SECCIONES_EXCLUSIVAS.includes(c));

/** Clave de la sección según la ruta ('/gestiones/caja' → 'caja') */
export function seccionDeRuta(ruta: string): string | null {
  const limpia = (ruta || '').split('?')[0].replace(/\/+$/, '');
  return SECCIONES.find(s => s.ruta === limpia)?.clave || null;
}

/** Permisos efectivos de un usuario (documento de Clientes) */
export function permisosDe(cliente: any): string[] {
  if (!cliente || cliente.administrador !== true || cliente.estado === false) return [];
  if (cliente.superAdmin === true || cliente.dueno === true) return SECCIONES.map(s => s.clave);
  if (Array.isArray(cliente.permisos)) return cliente.permisos.filter((p: any) => typeof p === 'string');
  return [...PERMISOS_POR_DEFECTO];
}
