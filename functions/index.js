/**
 * Funciones de Firebase de JC Exclusivo.
 *
 * analyticsTienda: datos de Google Analytics para el panel "Analytics de la tienda" de Gestiones.
 *  - Solo para administradores con permiso de Dashboard (se controla acá, en el servidor).
 *  - Lee la propiedad de GA4 configurada en functions/configuracion.js (GA_PROPERTY_ID).
 *  - Usa la cuenta de servicio de la función: hay que darle permiso de "Lector" en Google Analytics.
 *  - Guarda el resultado un rato (colección AnalyticsCache) para no consultar a Google de más.
 */

'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { BetaAnalyticsDataClient } = require('@google-analytics/data');
const panel = require('./analytics-panel');
const configuracion = require('./configuracion');

initializeApp();

/** Texto original del error de Google (se muestra en el panel para saber qué falta) */
function detalleError(err) {
  return String((err && (err.details || err.message)) || '').slice(0, 500);
}

let clienteGA = null;
function analyticsData() {
  if (!clienteGA) clienteGA = new BetaAnalyticsDataClient();
  return clienteGA;
}

exports.analyticsTienda = onCall(
  { region: 'us-central1', memory: '256MiB', timeoutSeconds: 60, maxInstances: 3 },
  async (request) => {

    // ---------- ¿Quién pide? ----------
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Iniciá sesión para ver Analytics.');
    }
    const db = getFirestore();
    const usuario = await db.doc(`Clientes/${request.auth.uid}`).get();
    if (!panel.puedeVerPanel(usuario.exists ? usuario.data() : null)) {
      throw new HttpsError('permission-denied', 'No tenés permiso para ver Analytics.');
    }

    // ---------- ¿Está configurado? ----------
    const propiedad = String(process.env.GA_PROPERTY_ID || configuracion.GA_PROPERTY_ID || '').trim();
    if (!/^\d+$/.test(propiedad)) {
      throw new HttpsError('failed-precondition', 'sin-configurar');
    }

    // ---------- Período ----------
    let rango;
    try {
      rango = panel.validarRango(request.data || {});
    } catch (err) {
      throw new HttpsError('invalid-argument', err.message);
    }

    const forzar = request.data && request.data.forzar === true;
    const ga = analyticsData();
    const property = `properties/${propiedad}`;

    // "Ahora mismo" (últimos 30 minutos): siempre fresco, es una consulta liviana
    let ahora = null;
    try {
      const [rt] = await ga.runRealtimeReport({ property, metrics: [{ name: 'activeUsers' }] });
      ahora = panel.usuariosAhora(rt);
    } catch (err) {
      const motivo = panel.motivoError(err);
      logger.warn('Google Analytics (tiempo real) respondió con error', { motivo, propiedad, detalle: detalleError(err) });
      if (motivo && motivo !== 'cuota') throw new HttpsError('failed-precondition', motivo, { detalle: detalleError(err), propiedad });
    }

    // ---------- ¿Ya lo tenemos guardado? ----------
    const refCache = db.doc(`AnalyticsCache/${propiedad}_${rango.desde}_${rango.hasta}`);
    if (!forzar) {
      const cache = await refCache.get();
      const guardado = cache.exists ? cache.data() : null;
      if (guardado && guardado.datos && Date.now() - guardado.guardadoEn < panel.vigenciaCache(rango)) {
        return { ...guardado.datos, ahora, desdeCache: true };
      }
    }

    // ---------- Consulta a Google Analytics ----------
    const { tanda1, tanda2 } = panel.pedidosPanel(rango);
    let r1, r2;
    try {
      [[r1], [r2]] = await Promise.all([
        ga.batchRunReports({ property, requests: tanda1 }),
        ga.batchRunReports({ property, requests: tanda2 })
      ]);
    } catch (err) {
      const motivo = panel.motivoError(err);
      logger.error('Error consultando Google Analytics', err);
      throw new HttpsError(motivo ? 'failed-precondition' : 'internal', motivo || 'No se pudo consultar Google Analytics.',
        { detalle: detalleError(err), propiedad });
    }

    const datos = panel.armarPanel(r1.reports || [], r2.reports || [], rango, null);

    try {
      await refCache.set({ datos, guardadoEn: Date.now() });
    } catch (err) {
      logger.warn('No se pudo guardar el caché de Analytics', err);
    }

    return { ...datos, ahora, desdeCache: false };
  }
);
