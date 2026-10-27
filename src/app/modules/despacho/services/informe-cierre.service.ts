import { Injectable } from '@angular/core';

/**
 * Genera el informe de cierre de caja para imprimir.
 *  - 'ticket': impresora térmica de 80 mm.
 *  - 'a4': hoja A4. Desde el diálogo de impresión se elige "Guardar como PDF".
 */
@Injectable({ providedIn: 'root' })
export class InformeCierreService {

  abrir(caja: any, nombreSucursal: string, formato: 'ticket' | 'a4' = 'a4'): void {
    const cierre = caja?.cierre;
    if (!cierre) {
      alert('Esta caja todavía no tiene cierre.');
      return;
    }

    const win = window.open('', '_blank', formato === 'ticket' ? 'width=420,height=700' : 'width=900,height=1000');
    if (!win) {
      alert('El navegador bloqueó la ventana del informe. Permití las ventanas emergentes para este sitio.');
      return;
    }

    win.document.write(this.html(caja, nombreSucursal, formato));
    win.document.close();
  }

  private html(caja: any, nombreSucursal: string, formato: 'ticket' | 'a4'): string {
    const c = caja.cierre;
    const r = c.resumen || {};
    const m = r.porMetodo || {};
    const mv = r.movimientos || {};
    const $ = (n: any) => this.moneda(n);

    const resultadoTexto =
      c.administrativo ? 'CIERRE ADMINISTRATIVO (SIN CONTEO)' :
      c.resultado === 'exacto' ? 'SIN DIFERENCIAS' :
      c.resultado === 'sobrante' ? `SOBRANTE ${$(Math.abs(c.diferencia))}` :
      `FALTANTE ${$(Math.abs(c.diferencia))}`;

    const abrio = caja.usuario?.nombre || caja.usuario?.usuario || caja.usuarioId || '-';
    const cerro = caja.cerradaPor?.nombre || caja.cerradaPor?.usuario || '-';

    const billetes = c.detalleBilletes
      ? Object.entries(c.detalleBilletes)
          .filter(([, cant]) => Number(cant) > 0)
          .sort(([a], [b]) => (a === 'monedas' ? -1 : Number(a)) < (b === 'monedas' ? -1 : Number(b)) ? 1 : -1)
          .map(([den, cant]) => `<tr><td>${den === 'monedas' ? 'Monedas / otros' : '$' + Number(den).toLocaleString('es-AR')}</td><td class="der">${den === 'monedas' ? $(cant) : cant + ' u.'}</td></tr>`)
          .join('')
      : '';

    const estilos = formato === 'ticket'
      ? `@page { size: 80mm auto; margin: 0; }
         body { width: 80mm; padding: 6px; font-family: monospace; font-size: 12px; }
         h1 { font-size: 15px; } h2 { font-size: 13px; }`
      : `@page { size: A4; margin: 18mm; }
         body { font-family: Arial, Helvetica, sans-serif; font-size: 13px; max-width: 720px; margin: 0 auto; }
         h1 { font-size: 22px; } h2 { font-size: 15px; margin-top: 22px; }
         .firmas { display: flex; gap: 60px; margin-top: 70px; }
         .firmas div { flex: 1; border-top: 1px solid #000; text-align: center; padding-top: 4px; }`;

    return `
<html>
<head>
  <meta charset="utf-8">
  <title>Cierre de caja - ${this.esc(nombreSucursal)} - ${this.fecha(caja.fechaApertura, false)}</title>
  <style>
    * { color: #000; }
    ${estilos}
    h1, h2 { text-align: center; margin: 6px 0; }
    table { width: 100%; border-collapse: collapse; margin: 6px 0; }
    td { padding: 3px 2px; border-bottom: 1px dashed #999; }
    .der { text-align: right; white-space: nowrap; }
    .total td { font-weight: bold; border-bottom: 2px solid #000; }
    .resultado { text-align: center; font-weight: bold; font-size: 1.2em; margin: 12px 0; padding: 8px; border: 2px solid #000; }
    .obs { margin-top: 8px; font-style: italic; }
    .pie { text-align: center; margin-top: 16px; font-size: 0.85em; }
    @media print { .no-print { display: none; } }
    .no-print { text-align: center; margin: 10px 0; padding: 8px; background: #fff3cd; font-family: Arial; font-size: 13px; }
  </style>
</head>
<body>
  ${formato === 'a4' ? '<div class="no-print">Para guardarlo como PDF, en el diálogo de impresión elegí <b>"Guardar como PDF"</b> como impresora.</div>' : ''}

  <h1>CIERRE DE CAJA</h1>
  <h2>${this.esc(nombreSucursal)}</h2>

  <table>
    <tr><td>Apertura</td><td class="der">${this.fecha(caja.fechaApertura)}</td></tr>
    <tr><td>Abrió</td><td class="der">${this.esc(abrio)}</td></tr>
    <tr><td>Cierre</td><td class="der">${this.fecha(caja.fechaCierre)}</td></tr>
    <tr><td>Cerró</td><td class="der">${this.esc(cerro)}</td></tr>
  </table>

  <h2>Ventas</h2>
  <table>
    <tr><td>Cantidad de ventas</td><td class="der">${r.cantidadVentas ?? 0}</td></tr>
    ${r.cantidadAnuladas ? `<tr><td>Ventas anuladas (no suman)</td><td class="der">${r.cantidadAnuladas}</td></tr>` : ''}
    <tr><td>Efectivo</td><td class="der">${$(m.efectivo)}</td></tr>
    <tr><td>Tarjeta</td><td class="der">${$(m.tarjeta)}</td></tr>
    <tr><td>Transferencia / QR</td><td class="der">${$(m.transferencia)}</td></tr>
    ${m.otros ? `<tr><td>Otros</td><td class="der">${$(m.otros)}</td></tr>` : ''}
    <tr class="total"><td>Total vendido</td><td class="der">${$(r.totalVendido)}</td></tr>
  </table>

  <h2>Efectivo en caja</h2>
  <table>
    <tr><td>Monto inicial</td><td class="der">${$(r.montoInicial)}</td></tr>
    <tr><td>+ Ventas en efectivo</td><td class="der">${$(m.efectivo)}</td></tr>
    ${mv.ingresos ? `<tr><td>+ Ingresos de efectivo</td><td class="der">${$(mv.ingresos)}</td></tr>` : ''}
    ${mv.retiros ? `<tr><td>− Retiros de efectivo</td><td class="der">${$(mv.retiros)}</td></tr>` : ''}
    ${mv.gastos ? `<tr><td>− Gastos</td><td class="der">${$(mv.gastos)}</td></tr>` : ''}
    ${mv.proveedores ? `<tr><td>− Pagos a proveedores</td><td class="der">${$(mv.proveedores)}</td></tr>` : ''}
    ${mv.depositos ? `<tr><td>− Depósitos bancarios</td><td class="der">${$(mv.depositos)}</td></tr>` : ''}
    <tr class="total"><td>Efectivo esperado</td><td class="der">${$(r.efectivoEsperado)}</td></tr>
    <tr class="total"><td>Efectivo contado</td><td class="der">${$(c.efectivoContado)}</td></tr>
    <tr><td>Diferencia</td><td class="der">${c.diferencia > 0 ? '+' : ''}${$(c.diferencia)}</td></tr>
  </table>

  <div class="resultado">${resultadoTexto}</div>

  ${billetes ? `<h2>Detalle del conteo</h2><table>${billetes}</table>` : ''}

  ${c.observacion ? `<div class="obs">Observación: ${this.esc(c.observacion)}</div>` : ''}

  ${formato === 'a4' ? `<div class="firmas"><div>Firma cajero</div><div>Firma responsable</div></div>` : ''}

  <div class="pie">Caja ${this.esc(caja.id)} · Impreso ${this.fecha(new Date().toISOString())}</div>

  <script>window.onload = function () { window.print(); };</script>
</body>
</html>`;
  }

  private moneda(n: any): string {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(Number(n) || 0);
  }

  private fecha(iso: any, conHora = true): string {
    if (!iso) return '-';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '-';
    return conHora
      ? d.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })
      : d.toLocaleDateString('es-AR');
  }

  /** Evita que un texto cargado por el usuario rompa el HTML del informe */
  private esc(texto: any): string {
    return String(texto ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
