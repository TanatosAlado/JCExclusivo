/**
 * Solicitud para ser cliente MAYORISTA (funciones puras, se pueden probar sin Angular).
 *
 * Flujo:
 *  - El cliente la pide al registrarse o desde "Mi cuenta": queda 'pendiente' y la cuenta sigue minorista.
 *  - Un administrador (permiso Clientes) la aprueba (esMayorista = true) o la rechaza con un motivo.
 *  - Rechazada: sigue como minorista y puede volver a pedirla.
 * Solo un administrador puede poner esMayorista en true (lo controlan las reglas de Firestore).
 */

export type EstadoSolicitudMayorista = 'pendiente' | 'aprobada' | 'rechazada';

export interface SolicitudMayorista {
  estado: EstadoSolicitudMayorista;
  fecha: string;                    // ISO, cuándo la pidió
  razonSocial: string;
  cuit: string;                     // 11 números, sin guiones
  motivo?: string | null;           // motivo del rechazo
  resueltaPor?: { uid: string; nombre: string } | null;
  resueltaEn?: string | null;       // ISO
}

export const MAX_RAZON_SOCIAL = 120;
export const MAX_MOTIVO_RECHAZO = 300;

/** "20-12345678-6" → "20123456786" */
export function limpiarCuit(cuit: any): string {
  return String(cuit ?? '').replace(/\D/g, '');
}

/** "20123456786" → "20-12345678-6" */
export function formatearCuit(cuit: any): string {
  const c = limpiarCuit(cuit);
  return c.length === 11 ? `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}` : String(cuit ?? '');
}

/** CUIT/CUIL válido: 11 números y dígito verificador correcto (módulo 11 de AFIP) */
export function cuitValido(cuit: any): boolean {
  const c = limpiarCuit(cuit);
  if (!/^\d{11}$/.test(c)) return false;
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((acc, p, i) => acc + p * Number(c[i]), 0);
  const resto = 11 - (suma % 11);
  const verificador = resto === 11 ? 0 : resto;
  return verificador !== 10 && verificador === Number(c[10]);
}

/** Error de los datos de la solicitud (null si están bien) */
export function errorDatosSolicitud(datos: { razonSocial?: any; cuit?: any }): string | null {
  const razon = String(datos?.razonSocial ?? '').trim();
  if (!razon) return 'Ingresá la razón social.';
  if (razon.length > MAX_RAZON_SOCIAL) return `La razón social puede tener hasta ${MAX_RAZON_SOCIAL} caracteres.`;
  const cuit = limpiarCuit(datos?.cuit);
  if (cuit.length !== 11) return 'El CUIT tiene que tener 11 números.';
  if (!cuitValido(cuit)) return 'El CUIT no es válido (revisá los números).';
  return null;
}

/** Solicitud nueva, lista para guardar (tira Error si los datos no están bien) */
export function nuevaSolicitud(datos: { razonSocial: any; cuit: any }, ahora = new Date()): SolicitudMayorista {
  const error = errorDatosSolicitud(datos);
  if (error) throw new Error(error);
  return {
    estado: 'pendiente',
    fecha: ahora.toISOString(),
    razonSocial: String(datos.razonSocial).trim(),
    cuit: limpiarCuit(datos.cuit)
  };
}

/** Estado de la solicitud del cliente (null si nunca pidió) */
export function estadoSolicitud(cliente: any): EstadoSolicitudMayorista | null {
  const e = cliente?.solicitudMayorista?.estado;
  return e === 'pendiente' || e === 'aprobada' || e === 'rechazada' ? e : null;
}

/** ¿Puede pedir ser mayorista? (no si ya lo es o si tiene una pendiente) */
export function puedePedirMayorista(cliente: any): boolean {
  return !!cliente && cliente.id !== 'invitado' && cliente.esMayorista !== true && estadoSolicitud(cliente) !== 'pendiente';
}

/**
 * Aviso para mostrar al iniciar sesión (una vez por novedad).
 * clave: para recordar en el navegador que ya se mostró.
 */
export function avisoSolicitud(cliente: any): { clave: string; tipo: 'info' | 'ok' | 'mal'; texto: string } | null {
  const s: SolicitudMayorista | undefined = cliente?.solicitudMayorista;
  const estado = estadoSolicitud(cliente);
  if (!s || !estado || !cliente?.id) return null;
  const clave = `avisoMayorista:${cliente.id}:${estado}:${s.resueltaEn || s.fecha}`;
  if (estado === 'pendiente') {
    return { clave, tipo: 'info', texto: 'Tu solicitud de cuenta mayorista está en revisión. Mientras tanto ves los precios minoristas.' };
  }
  if (estado === 'aprobada') {
    return { clave, tipo: 'ok', texto: '¡Tu cuenta mayorista fue aprobada! Ya ves los precios mayoristas.' };
  }
  return {
    clave, tipo: 'mal',
    texto: 'Tu solicitud de cuenta mayorista no fue aprobada' + (s.motivo ? `: ${s.motivo}` : '.') + ' Podés seguir comprando como minorista.'
  };
}

/** Pendientes primero; dentro de cada grupo, las más nuevas primero */
export function ordenarSolicitudes<T extends { solicitudMayorista?: SolicitudMayorista }>(lista: T[]): T[] {
  const peso = (x: T) => (x.solicitudMayorista?.estado === 'pendiente' ? 0 : 1);
  const fecha = (x: T) => x.solicitudMayorista?.resueltaEn || x.solicitudMayorista?.fecha || '';
  return [...lista].sort((a, b) => peso(a) - peso(b) || fecha(b).localeCompare(fecha(a)));
}
