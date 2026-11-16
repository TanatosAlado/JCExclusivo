/**
 * 🔔 Avisos para los administradores (funciones puras: se prueban sin Angular).
 *  - Pedidos web que entraron y siguen pendientes (permiso Pedidos).
 *  - Solicitudes de cuenta mayorista pendientes (permiso Clientes, donde se aprueban).
 */

export type TipoAvisoAdmin = 'pedido' | 'mayorista';

export interface AvisoAdmin {
  id: string;                 // 'pedido:<id>' | 'mayorista:<id>'
  tipo: TipoAvisoAdmin;
  titulo: string;
  detalle: string;
  fecha: Date | null;
  ruta: string;
  /** Título del aviso flotante ("🛒 Nuevo pedido", "💳 Comprobante recibido"…) */
  etiqueta: string;
}

export const MAX_AVISOS_LISTA = 15;

/** Fecha de un pedido: ISO o "dd/MM/yyyy HH:mm" (como la guarda el checkout) */
export function fechaAviso(valor: any): Date | null {
  if (!valor) return null;
  if (valor instanceof Date) return isNaN(valor.getTime()) ? null : valor;
  if (typeof valor?.toDate === 'function') return valor.toDate();
  const s = String(valor).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const d = new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

const pesos = (n: any) => '$ ' + Math.round(Number(n) || 0).toLocaleString('es-AR');

export function avisoDePedido(id: string, p: any): AvisoAdmin {
  const nombre = [p?.nombreCliente, p?.apellidoCliente].filter(Boolean).join(' ').trim() || String(p?.user || 'Cliente');
  const pago = p?.pagoTransferencia;
  // 💳 Comprobante por verificar: el id cambia con cada comprobante (así avisa cuando llega uno nuevo)
  const comprobante = pago?.estado === 'por-verificar';
  const titulo = p?.nroPedido ? `Pedido #${p.nroPedido}` : 'Pedido nuevo';
  return {
    id: 'pedido:' + id + (comprobante ? `:comprobante:${(pago.comprobantes || []).length}` : ''),
    tipo: 'pedido',
    titulo: comprobante ? `${titulo} · comprobante por verificar` : titulo,
    detalle: `${nombre} · ${pesos(p?.total)}`,
    fecha: fechaAviso(comprobante ? (pago.ultimoComprobante || p?.fecha) : (p?.fechaCreacion || p?.fecha)),
    ruta: '/gestiones/pedidos',
    etiqueta: comprobante ? '💳 Comprobante recibido' : '🛒 Nuevo pedido'
  };
}

export function avisoDeMayorista(id: string, c: any): AvisoAdmin {
  const s = c?.solicitudMayorista || {};
  const nombre = [c?.nombre, c?.apellido].filter(Boolean).join(' ').trim();
  return {
    id: 'mayorista:' + id,
    tipo: 'mayorista',
    titulo: 'Solicitud de cuenta mayorista',
    detalle: [s.razonSocial || c?.razonSocial, nombre].filter(Boolean).join(' · ') || 'Cliente',
    fecha: fechaAviso(s.fecha),
    ruta: '/gestiones/solicitudes-mayoristas',
    etiqueta: '🏪 Nueva solicitud mayorista'
  };
}

/** Más nuevos primero (los sin fecha, al final) */
export function ordenarAvisos(lista: AvisoAdmin[]): AvisoAdmin[] {
  return [...lista].sort((a, b) => (b.fecha?.getTime() ?? 0) - (a.fecha?.getTime() ?? 0));
}

/** Los que no estaban antes (para el aviso flotante). En la primera carga no se avisa nada. */
export function avisosNuevos(conocidos: Set<string> | null, actuales: AvisoAdmin[]): AvisoAdmin[] {
  if (!conocidos) return [];
  return actuales.filter(a => !conocidos.has(a.id));
}

/** "recién", "hace 5 min", "hace 2 h", "hace 3 días" */
export function haceCuanto(fecha: Date | null, ahora = new Date()): string {
  if (!fecha) return '';
  const min = Math.floor((ahora.getTime() - fecha.getTime()) / 60000);
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} día${d === 1 ? '' : 's'}`;
}
