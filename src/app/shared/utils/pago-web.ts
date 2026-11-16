/**
 * 💳 Pago online de los pedidos web (funciones puras, se prueban sin Angular).
 *
 *  - Minoristas e invitados: Transferencia (con el % de descuento de Gestiones → Empresa, solo sobre productos).
 *    Con retiro en sucursal también pueden elegir "Pagar al retirar". Mercado Pago queda preparado (apagado).
 *  - Mayoristas: como siempre (efectivo o transferencia/QR con envío; con retiro no se elige).
 *  - El comprobante es opcional: se puede subir en el checkout o después (link del pedido / Mi cuenta).
 *  - El pago lo valida un administrador en Gestiones → Pedidos.
 */

export type MetodoPagoWeb = 'transferencia' | 'mercadopago' | 'al-retirar' | 'efectivo' | 'qr';
export type EntregaWeb = 'domicilio' | 'local';

/** 🔒 Mercado Pago: preparado pero apagado hasta que se integre */
export const MERCADO_PAGO_ACTIVO = false;

export type EstadoPagoTransferencia = 'esperando' | 'por-verificar' | 'aprobado' | 'rechazado';

export interface ComprobantePago {
  path: string;                 // ruta en Storage (el admin pide el link al verlo)
  nombre: string;
  tipo: string;                 // image/jpeg, application/pdf…
  tamano: number;               // bytes
  fecha: string;                // ISO
}

export interface PagoTransferencia {
  alias?: string | null;        // a dónde se pidió transferir (queda guardado en el pedido)
  cvu?: string | null;
  titular?: string | null;
  dni?: string | null;
  porcentaje: number;           // % de descuento aplicado
  descuento: number;            // $ descontados
  monto: number;                // $ a transferir (el total del pedido)
  estado: EstadoPagoTransferencia;
  comprobantes: ComprobantePago[];
  ultimoComprobante?: string | null;
  verificadoPor?: { uid: string; nombre: string } | null;
  verificadoEn?: string | null;
  motivoRechazo?: string | null;
}

export interface OpcionPagoWeb {
  valor: MetodoPagoWeb;
  texto: string;
  detalle?: string;
}

export const MAX_COMPROBANTE_BYTES = 5 * 1024 * 1024;
export const MAX_COMPROBANTES = 10;
export const TIPOS_COMPROBANTE = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];

/** Opciones de pago según el cliente y la entrega */
export function opcionesPagoWeb(esMayorista: boolean, entrega: EntregaWeb | '', porcentajeTransferencia: number, mpActivo = MERCADO_PAGO_ACTIVO): OpcionPagoWeb[] {
  if (!entrega) return [];
  if (esMayorista) {
    return entrega === 'domicilio'
      ? [{ valor: 'efectivo', texto: 'Efectivo' }, { valor: 'qr', texto: 'Transferencia / QR' }]
      : [];
  }
  const pct = Number(porcentajeTransferencia) || 0;
  const lista: OpcionPagoWeb[] = [{
    valor: 'transferencia',
    texto: pct > 0 ? `Transferencia (${pct}% OFF)` : 'Transferencia',
    detalle: pct > 0 ? `${pct}% de descuento en productos y accesorios (no en equipos)` : undefined
  }];
  if (mpActivo) lista.push({ valor: 'mercadopago', texto: 'Mercado Pago', detalle: 'Tarjeta, dinero en cuenta o cuotas' });
  if (entrega === 'local') lista.push({ valor: 'al-retirar', texto: 'Pagar al retirar', detalle: 'Pagás en el local cuando lo retirás' });
  return lista;
}

/** Texto de la forma de pago que se guarda en el pedido */
export function textoPagoPedido(metodo: MetodoPagoWeb | '', entrega: EntregaWeb | ''): string {
  switch (metodo) {
    case 'transferencia': case 'qr': return 'Transferencia';
    case 'mercadopago': return 'Mercado Pago';
    case 'al-retirar': return 'Pago al retirar';
    case 'efectivo': return 'Efectivo';
    default: return entrega === 'local' ? 'S/P' : 'S/P';
  }
}

/** Revisa el archivo del comprobante. null = está bien. */
export function errorComprobante(archivo: { type?: string; size?: number; name?: string } | null | undefined): string | null {
  if (!archivo) return 'Elegí el archivo del comprobante.';
  const tipo = String(archivo.type || '').toLowerCase();
  const nombre = String(archivo.name || '').toLowerCase();
  const ok = TIPOS_COMPROBANTE.includes(tipo) || (!tipo && /\.(jpe?g|png|webp|heic|heif|pdf)$/.test(nombre));
  if (!ok) return 'El comprobante tiene que ser una foto (JPG, PNG) o un PDF.';
  if (!(Number(archivo.size) > 0)) return 'El archivo está vacío.';
  if (Number(archivo.size) > MAX_COMPROBANTE_BYTES) return 'El archivo es muy pesado (máximo 5 MB).';
  return null;
}

/** Tipo de contenido para subir (algunos celulares no lo informan) */
export function tipoComprobante(archivo: { type?: string; name?: string }): string {
  const t = String(archivo?.type || '').toLowerCase();
  if (t) return t;
  const n = String(archivo?.name || '').toLowerCase();
  if (n.endsWith('.pdf')) return 'application/pdf';
  if (n.endsWith('.png')) return 'image/png';
  if (n.endsWith('.webp')) return 'image/webp';
  if (n.endsWith('.heic')) return 'image/heic';
  return 'image/jpeg';
}

/** Ruta en Storage: comprobantes/{pedidoId}/{fecha}-{nombre-limpio} */
export function rutaComprobante(pedidoId: string, nombre: string, fecha = new Date()): string {
  const limpio = String(nombre || 'comprobante')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').slice(-60) || 'comprobante';
  return `comprobantes/${pedidoId}/${fecha.getTime()}-${limpio}`;
}

/** Cuenta destino de una transferencia */
export interface DatosTransferencia {
  alias: string | null;
  cvu: string | null;
  titular: string | null;     // nombre y apellido del titular
  dni: string | null;
}

/**
 * A dónde transfiere cada tipo de cliente (Gestiones → Empresa), con el titular y el DNI para verificar.
 *  - Minoristas / invitados: la cuenta minorista. Si todavía no se cargó nada minorista, se usa lo viejo (un solo alias / CVU).
 *  - Mayoristas: la cuenta mayorista (si falta, el alias / CVU viejos).
 */
export function datosTransferencia(info: any, esMayorista: boolean): DatosTransferencia {
  const t = (v: any) => String(v ?? '').trim() || null;
  const aliasViejo = t(info?.alias);
  const cvuViejo = t(info?.cvu);
  if (esMayorista) {
    return { alias: t(info?.aliasMayorista) || aliasViejo, cvu: t(info?.cvuMayorista) || cvuViejo, titular: t(info?.titularMayorista), dni: t(info?.dniMayorista) };
  }
  const alias = t(info?.aliasMinorista);
  const cvu = t(info?.cvuMinorista);
  if (!alias && !cvu) return { alias: aliasViejo, cvu: cvuViejo, titular: t(info?.titularMinorista), dni: t(info?.dniMinorista) };
  return { alias, cvu, titular: t(info?.titularMinorista), dni: t(info?.dniMinorista) };
}

/** Pago inicial al crear el pedido (siempre "esperando": el comprobante se agrega después) */
export function pagoTransferenciaInicial(porcentaje: number, descuento: number, monto: number,
  destino: Partial<DatosTransferencia> = {}): PagoTransferencia {
  const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
  return {
    alias: destino.alias || null, cvu: destino.cvu || null, titular: destino.titular || null, dni: destino.dni || null,
    porcentaje: Number(porcentaje) || 0, descuento: r2(descuento), monto: r2(monto), estado: 'esperando',
    comprobantes: [], ultimoComprobante: null, verificadoPor: null, verificadoEn: null, motivoRechazo: null
  };
}

/** ¿Se puede subir un comprobante? */
export function puedeSubirComprobante(pago: PagoTransferencia | null | undefined, coleccion = 'Pedidos Pendientes'): boolean {
  if (!pago || coleccion !== 'Pedidos Pendientes') return false;
  return ['esperando', 'por-verificar', 'rechazado'].includes(pago.estado) && (pago.comprobantes || []).length < MAX_COMPROBANTES;
}

export const TEXTO_ESTADO_PAGO: Record<EstadoPagoTransferencia, string> = {
  'esperando': 'Esperando el comprobante',
  'por-verificar': 'Comprobante por verificar',
  'aprobado': 'Pago confirmado',
  'rechazado': 'Pago rechazado'
};

/** "1,2 MB" / "350 KB" */
export function textoTamano(bytes: number): string {
  const b = Number(bytes) || 0;
  return b >= 1024 * 1024 ? (b / 1024 / 1024).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
}
