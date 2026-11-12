/**
 * Impresión de tickets, presupuestos, comprobantes e informes.
 *
 * ANTES se abría una ventana aparte (window.open) que se imprimía sola al cargar. Esa ventana
 * comparte el "hilo" con la página que la abrió: mientras su cuadro de impresión sigue abierto,
 * Despacho queda congelado. Si la ventanita quedaba escondida detrás de la principal, el cuadro
 * de impresión seguía abierto sin verse y había que apretar F5.
 *
 * AHORA se imprime desde un marco invisible dentro de la misma página: el cuadro de impresión
 * aparece siempre encima, al cerrarlo la página sigue funcionando, y el marco se borra solo.
 * (Además no lo frena el bloqueador de ventanas emergentes.)
 */

const ID_MARCO = 'marco-impresion-jc';

/** Hay un cuadro de impresión abierto (o preparándose): no se arranca otro encima */
let imprimiendo = false;
let ultimoInicio = 0;
/** Protección contra el doble clic: mientras tanto, otra impresión no pisa la que se está armando */
const GUARDA_MS = 15000;
/** Si nunca llega el aviso de "terminó de imprimir", el marco se borra igual después de esto */
const MAX_ESPERA_MS = 60000;

/** Saca el "imprimir al cargar" de los HTML que se armaban para la ventana aparte */
export function sinAutoImpresion(html: string): string {
  // Cualquier <script> que llame a window.print() solo (los botones "Imprimir" usan onclick y no se tocan)
  return String(html || '').replace(/<script\b[^>]*>[^<]*window\.print\s*\([^<]*<\/script>/gi, '');
}

/** Espera a que carguen las imágenes (el logo) para que no salga el ticket sin logo; máximo 3 s */
function esperarImagenes(doc: Document, maxMs = 3000): Promise<void> {
  const pendientes = Array.from(doc.images || []).filter(img => !img.complete);
  if (!pendientes.length) return Promise.resolve();
  return new Promise(resolve => {
    let faltan = pendientes.length;
    const listo = () => { if (--faltan <= 0) resolve(); };
    pendientes.forEach(img => {
      img.addEventListener('load', listo, { once: true });
      img.addEventListener('error', listo, { once: true });
    });
    setTimeout(resolve, maxMs);
  });
}

/**
 * Imprime un HTML completo (<html>...</html>) sin abrir otra ventana.
 * Devuelve cuando se lanzó el cuadro de impresión.
 */
export async function imprimirEnPagina(html: string): Promise<void> {
  // Si ya hay una impresión en curso (doble clic, o el cuadro todavía abierto), no se pisa:
  // borrar el marco mientras Chrome arma la vista previa es lo que dejaba la página tildada.
  if (imprimiendo && Date.now() - ultimoInicio < GUARDA_MS) return;
  imprimiendo = true;
  ultimoInicio = Date.now();

  // Si quedó un marco de una impresión anterior (ya terminada), se descarta
  document.getElementById(ID_MARCO)?.remove();

  const marco = document.createElement('iframe');
  marco.id = ID_MARCO;
  marco.setAttribute('aria-hidden', 'true');
  marco.setAttribute('tabindex', '-1');
  // Fuera de la pantalla pero con tamaño real: con tamaño 0 algunos Chrome se quedan
  // "cargando la vista previa" (y con display:none imprimen en blanco)
  Object.assign(marco.style, {
    position: 'fixed', left: '-10000px', top: '0', width: '800px', height: '1000px',
    border: '0', opacity: '0', pointerEvents: 'none'
  });
  document.body.appendChild(marco);

  const win = marco.contentWindow;
  const doc = marco.contentDocument || win?.document;
  if (!win || !doc) {
    marco.remove();
    imprimiendo = false;
    throw new Error('No se pudo preparar la impresión.');
  }

  doc.open();
  doc.write(sinAutoImpresion(html));
  doc.close();

  await esperarImagenes(doc);

  let borrado = false;
  const terminar = () => {
    if (borrado) return;
    borrado = true;
    imprimiendo = false;
    // La página principal recupera el foco (así el lector de códigos y el teclado siguen andando)
    window.focus();
    // Un instante después, para no cortar la impresión en curso
    setTimeout(() => marco.remove(), 1000);
  };
  win.addEventListener('afterprint', terminar, { once: true });

  // Un respiro para que el navegador termine de armar la página antes de imprimir
  await new Promise(r => setTimeout(r, 50));

  try {
    win.focus();
    win.print();          // Chrome/Edge: espera acá hasta que se cierra el cuadro de impresión
  } catch (err) {
    terminar();
    throw err;
  } finally {
    // Por si el navegador no avisa "afterprint": se libera igual más tarde
    setTimeout(terminar, MAX_ESPERA_MS);
    setTimeout(() => window.focus(), 0);
  }
}

/**
 * Vista previa en una ventana aparte (con botones Imprimir / Cerrar).
 * Al terminar de imprimir desde esa ventana, se cierra sola para no quedar abierta escondida.
 */
export function abrirVistaPrevia(html: string, caracteristicas = 'width=420,height=760'): boolean {
  const win = window.open('', '_blank', caracteristicas);
  if (!win) return false;
  const conCierre = sinAutoImpresion(html).replace(
    /<\/body>/i,
    '<script>window.addEventListener("afterprint", function () { setTimeout(function () { window.close(); }, 300); });</script></body>'
  );
  win.document.write(conCierre);
  win.document.close();
  win.focus();
  return true;
}
