/**
 * Panel de Analytics de la tienda (Gestiones) — funciones puras.
 * Arman los pedidos a la API de datos de Google Analytics (GA4) y convierten
 * las respuestas en los números que muestra el panel. Se prueban sin conectarse a Google.
 */

'use strict';

const ZONA = 'America/Argentina/Buenos_Aires';
const MAX_DIAS = 400;

/** Pasos del embudo de compra (eventos que manda la tienda), en orden */
const PASOS_EMBUDO = [
  { evento: 'view_item', nombre: 'Vieron un producto' },
  { evento: 'add_to_cart', nombre: 'Agregaron al carrito' },
  { evento: 'begin_checkout', nombre: 'Iniciaron la compra' },
  { evento: 'purchase', nombre: 'Compraron' }
];

const CANALES = {
  'Direct': 'Directo (escribieron la dirección o un link guardado)',
  'Organic Search': 'Búsqueda en Google y otros buscadores',
  'Organic Social': 'Redes sociales',
  'Referral': 'Links desde otros sitios',
  'Paid Search': 'Anuncios en buscadores',
  'Paid Social': 'Anuncios en redes',
  'Email': 'Email',
  'Organic Video': 'Videos (YouTube, etc.)',
  'Display': 'Anuncios gráficos',
  'Organic Shopping': 'Google Shopping',
  'Cross-network': 'Campañas de Google',
  'Unassigned': 'Sin identificar'
};

const DISPOSITIVOS = { mobile: 'Celular', desktop: 'Computadora', tablet: 'Tablet', smarttv: 'Smart TV' };

const PAGINAS = {
  '/': 'Inicio', '/inicio': 'Inicio', '/productos': 'Productos', '/producto': 'Detalle de producto',
  '/checkout': 'Checkout', '/mi-cuenta': 'Mi cuenta', '/consulta': 'Consulta de reparación',
  '/nosotros': 'Nosotros', '/contacto': 'Contacto'
};

// =====================================================
// FECHAS
// =====================================================

/** "YYYY-MM-DD" de hoy en Argentina */
function hoyArgentina(ahora = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ahora);
}

function aFecha(s) {
  const [a, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d));
}

function aTexto(f) {
  return f.toISOString().slice(0, 10);
}

function sumarDias(s, n) {
  const f = aFecha(s);
  f.setUTCDate(f.getUTCDate() + n);
  return aTexto(f);
}

function diasEntre(desde, hasta) {
  return Math.round((aFecha(hasta) - aFecha(desde)) / 86400000);
}

/**
 * Valida el período pedido y calcula el anterior (mismo largo, justo antes).
 * Tira Error con un mensaje claro si algo no está bien.
 */
function validarRango(datos, ahora = new Date()) {
  const desde = String(datos && datos.desde || '');
  const hasta = String(datos && datos.hasta || '');
  const formato = /^\d{4}-\d{2}-\d{2}$/;
  if (!formato.test(desde) || !formato.test(hasta) || isNaN(aFecha(desde)) || isNaN(aFecha(hasta))) {
    throw new Error('Las fechas no son válidas.');
  }
  if (desde > hasta) throw new Error('La fecha "desde" tiene que ser anterior a "hasta".');
  const hoy = hoyArgentina(ahora);
  if (hasta > hoy) throw new Error('La fecha "hasta" no puede ser posterior a hoy.');
  const largo = diasEntre(desde, hasta);
  if (largo > MAX_DIAS) throw new Error('Elegí un período de hasta un año.');
  const anteriorHasta = sumarDias(desde, -1);
  const anteriorDesde = sumarDias(anteriorHasta, -largo);
  return { desde, hasta, anterior: { desde: anteriorDesde, hasta: anteriorHasta }, incluyeHoy: hasta === hoy };
}

// =====================================================
// PEDIDOS A GOOGLE
// =====================================================

const metrica = (...nombres) => nombres.map(name => ({ name }));
const dimension = (...nombres) => nombres.map(name => ({ name }));
const ordenMetrica = (name) => [{ metric: { metricName: name }, desc: true }];
const filtroEvento = (...eventos) => ({
  filter: eventos.length === 1
    ? { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: eventos[0] } }
    : { fieldName: 'eventName', inListFilter: { values: eventos } }
});

/** Dos tandas de hasta 5 informes (es el máximo de Google por pedido) */
function pedidosPanel(r) {
  const periodo = [{ startDate: r.desde, endDate: r.hasta }];
  const tanda1 = [
    { // 0: totales, contra el período anterior
      dateRanges: [{ startDate: r.desde, endDate: r.hasta, name: 'actual' }, { startDate: r.anterior.desde, endDate: r.anterior.hasta, name: 'anterior' }],
      metrics: metrica('activeUsers', 'newUsers', 'sessions', 'screenPageViews', 'engagementRate', 'averageSessionDuration', 'transactions', 'purchaseRevenue')
    },
    { // 1: por día
      dateRanges: periodo, dimensions: dimension('date'), metrics: metrica('activeUsers', 'sessions', 'screenPageViews'),
      orderBys: [{ dimension: { dimensionName: 'date' } }], limit: MAX_DIAS + 1
    },
    { // 2: embudo
      dateRanges: periodo, dimensions: dimension('eventName'), metrics: metrica('eventCount', 'totalUsers'),
      dimensionFilter: filtroEvento(...PASOS_EMBUDO.map(p => p.evento))
    },
    { // 3: productos
      dateRanges: periodo, dimensions: dimension('itemName'), metrics: metrica('itemsViewed', 'itemsAddedToCart', 'itemsPurchased'),
      orderBys: ordenMetrica('itemsViewed'), limit: 15
    },
    { // 4: búsquedas
      dateRanges: periodo, dimensions: dimension('searchTerm'), metrics: metrica('eventCount'),
      dimensionFilter: filtroEvento('search'), orderBys: ordenMetrica('eventCount'), limit: 15
    }
  ];
  const tanda2 = [
    { dateRanges: periodo, dimensions: dimension('sessionDefaultChannelGroup'), metrics: metrica('sessions'), orderBys: ordenMetrica('sessions'), limit: 12 },
    { dateRanges: periodo, dimensions: dimension('sessionSource'), metrics: metrica('sessions'), orderBys: ordenMetrica('sessions'), limit: 10 },
    { dateRanges: periodo, dimensions: dimension('deviceCategory'), metrics: metrica('activeUsers'), orderBys: ordenMetrica('activeUsers'), limit: 5 },
    { dateRanges: periodo, dimensions: dimension('city'), metrics: metrica('activeUsers'), orderBys: ordenMetrica('activeUsers'), limit: 10 },
    { dateRanges: periodo, dimensions: dimension('pagePath'), metrics: metrica('screenPageViews'), orderBys: ordenMetrica('screenPageViews'), limit: 50 }
  ];
  return { tanda1, tanda2 };
}

// =====================================================
// RESPUESTAS → PANEL
// =====================================================

const num = (v) => {
  const n = Number(v);
  return isFinite(n) ? n : 0;
};

/** Filas de un informe como [{ d: [...dimensiones], m: [...métricas] }] */
function filas(informe) {
  return ((informe && informe.rows) || []).map(f => ({
    d: (f.dimensionValues || []).map(x => (x && x.value) || ''),
    m: (f.metricValues || []).map(x => num(x && x.value))
  }));
}

const sinDato = (s) => !s || s === '(not set)' || s === '(other)';

function totalesDe(fila) {
  const m = (fila && fila.m) || [];
  return {
    usuarios: m[0] || 0, nuevos: m[1] || 0, sesiones: m[2] || 0, vistas: m[3] || 0,
    interaccion: m[4] || 0, duracionMedia: m[5] || 0, compras: m[6] || 0, ingresos: m[7] || 0
  };
}

/** Ruta agrupada (los /producto/<id> cuentan juntos) */
function rutaAgrupada(ruta) {
  const r = String(ruta || '/').split(/[?#]/)[0] || '/';
  return r.replace(/^\/producto\/[^/]+$/i, '/producto').replace(/^\/consulta\/[^/]+$/i, '/consulta');
}

function armarPanel(tanda1, tanda2, rango, ahora) {
  const [rTot, rDia, rEmb, rProd, rBus] = tanda1 || [];
  const [rCan, rFue, rDis, rCiu, rPag] = tanda2 || [];

  // Totales: con dos períodos, Google agrega la dimensión del período (nombre 'actual' / 'anterior')
  const tot = filas(rTot);
  const actual = tot.find(f => f.d[0] === 'actual') || (tot.length && !tot[0].d.length ? tot[0] : null);
  const anterior = tot.find(f => f.d[0] === 'anterior');

  // Por día, con los días sin visitas en cero
  const porFecha = new Map(filas(rDia).map(f => {
    const s = f.d[0];
    return [`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`, f.m];
  }));
  const porDia = [];
  for (let d = rango.desde; d <= rango.hasta; d = sumarDias(d, 1)) {
    const m = porFecha.get(d) || [];
    porDia.push({ fecha: d, usuarios: m[0] || 0, sesiones: m[1] || 0, vistas: m[2] || 0 });
  }

  const emb = new Map(filas(rEmb).map(f => [f.d[0], f.m]));
  const embudo = PASOS_EMBUDO.map(p => ({
    evento: p.evento, nombre: p.nombre,
    eventos: (emb.get(p.evento) || [])[0] || 0,
    usuarios: (emb.get(p.evento) || [])[1] || 0
  }));

  const productos = filas(rProd)
    .filter(f => !sinDato(f.d[0]))
    .map(f => ({ nombre: f.d[0], vistos: f.m[0], agregados: f.m[1], comprados: f.m[2] }))
    .slice(0, 10);

  const busquedas = filas(rBus)
    .filter(f => !sinDato(f.d[0]))
    .map(f => ({ termino: f.d[0], veces: f.m[0] }))
    .slice(0, 10);

  const canales = filas(rCan).map(f => ({ nombre: CANALES[f.d[0]] || f.d[0] || 'Sin identificar', sesiones: f.m[0] }));
  const fuentes = filas(rFue).map(f => ({
    nombre: f.d[0] === '(direct)' ? 'Directo' : sinDato(f.d[0]) ? 'Sin identificar' : f.d[0],
    sesiones: f.m[0]
  }));
  const dispositivos = filas(rDis).map(f => ({ nombre: DISPOSITIVOS[f.d[0]] || f.d[0] || 'Otro', usuarios: f.m[0] }));
  const ciudades = filas(rCiu).map(f => ({ nombre: sinDato(f.d[0]) ? 'Sin identificar' : f.d[0], usuarios: f.m[0] }));

  const paginasMap = new Map();
  for (const f of filas(rPag)) {
    const ruta = rutaAgrupada(f.d[0]);
    paginasMap.set(ruta, (paginasMap.get(ruta) || 0) + f.m[0]);
  }
  const paginas = [...paginasMap.entries()]
    .map(([ruta, vistas]) => ({ ruta, nombre: PAGINAS[ruta] || ruta, vistas }))
    .sort((a, b) => b.vistas - a.vistas)
    .slice(0, 10);

  return {
    rango: { desde: rango.desde, hasta: rango.hasta, anterior: rango.anterior },
    totales: totalesDe(actual),
    anterior: anterior ? totalesDe(anterior) : null,
    porDia, embudo, productos, busquedas, canales, fuentes, dispositivos, ciudades, paginas,
    ahora: ahora === undefined ? null : ahora,
    generado: new Date().toISOString()
  };
}

/** Usuarios activos en los últimos 30 minutos (informe de tiempo real) */
function usuariosAhora(informe) {
  const f = filas(informe);
  return f.length ? f.reduce((a, x) => a + (x.m[0] || 0), 0) : 0;
}

// =====================================================
// PERMISOS Y ERRORES
// =====================================================

/**
 * ¿Puede ver el panel? Mismo permiso que el Dashboard (core/secciones.ts de la app):
 * administrador habilitado + (superadmin / dueño, o 'dashboard' entre sus permisos).
 * El Dashboard es sección exclusiva: un admin sin permisos cargados no lo ve.
 */
function puedeVerPanel(cliente) {
  if (!cliente || cliente.administrador !== true || cliente.estado === false) return false;
  if (cliente.superAdmin === true || cliente.dueno === true) return true;
  return Array.isArray(cliente.permisos) && cliente.permisos.includes('dashboard');
}

/** Error de Google → motivo que entiende la pantalla */
function motivoError(err) {
  const texto = String((err && (err.details || err.message)) || '');
  const codigo = err && err.code;
  if (/has not been used|is disabled|SERVICE_DISABLED|accessNotConfigured/i.test(texto)) return 'api-desactivada';
  if (codigo === 7 || /PERMISSION_DENIED|sufficient permissions|does not have permission/i.test(texto)) return 'sin-permiso-ga';
  if (codigo === 5 || /NOT_FOUND|property.*not found/i.test(texto)) return 'propiedad-incorrecta';
  if (codigo === 8 || /RESOURCE_EXHAUSTED|quota/i.test(texto)) return 'cuota';
  return null;
}

/** Cuánto dura guardado un resultado: períodos cerrados más tiempo; si incluye hoy, 15 minutos */
function vigenciaCache(rango) {
  return rango.incluyeHoy ? 15 * 60 * 1000 : 6 * 60 * 60 * 1000;
}

module.exports = {
  PASOS_EMBUDO, hoyArgentina, sumarDias, validarRango, pedidosPanel, armarPanel, usuariosAhora,
  puedeVerPanel, motivoError, vigenciaCache, rutaAgrupada
};
