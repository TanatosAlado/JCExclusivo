import { Injectable } from '@angular/core';
import { Firestore, collection, getDocs } from '@angular/fire/firestore';

/** Datos mínimos de un cliente para mostrar en el buscador */
export interface ClienteEncontrado {
  id: string;
  nombre: string;
  apellido: string;
  razonSocial: string;
  dni: any;
  cuit: any;
  telefono: string;
  mail: string;
  esMayorista: boolean;
  puntos: number;
  data: any;          // documento completo (por si la pantalla necesita algo más)
}

/**
 * Búsqueda de clientes por nombre, apellido, razón social, DNI o CUIT
 * mientras se escribe.
 *
 * Firestore no permite buscar "texto contenido", así que los clientes se leen una vez
 * (queda en memoria unos minutos) y se filtra en el navegador:
 *  - sin distinguir mayúsculas ni tildes ("perez" encuentra "Pérez"),
 *  - varias palabras en cualquier orden ("juan perez" = "perez juan"),
 *  - cada palabra puede ser parte del texto ("gonz" encuentra "González").
 */
@Injectable({ providedIn: 'root' })
export class BuscadorClientesService {

  private static readonly VIGENCIA_MS = 10 * 60 * 1000; // 10 minutos

  private cache: { clientes: (ClienteEncontrado & { _texto: string })[]; leido: number } | null = null;
  private cargando: Promise<void> | null = null;

  constructor(private firestore: Firestore) { }

  /** Normaliza para comparar: minúsculas, sin tildes, sin espacios dobles */
  static normalizar(texto: any): string {
    return String(texto ?? '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Fuerza a volver a leer los clientes en la próxima búsqueda (ej: después de dar de alta uno) */
  invalidar() {
    this.cache = null;
  }

  async buscar(texto: string, max = 10): Promise<ClienteEncontrado[]> {
    const palabras = BuscadorClientesService.normalizar(texto).split(' ').filter(Boolean);
    if (!palabras.length) return [];
    await this.asegurarCache();
    return BuscadorClientesService.filtrar(this.cache!.clientes, palabras, max);
  }

  /** Filtro puro (separado para poder probarlo) */
  static filtrar<T extends ClienteEncontrado & { _texto: string }>(clientes: T[], palabras: string[], max: number): T[] {
    const primera = palabras[0];
    return clientes
      .filter(c => palabras.every(p => c._texto.includes(p)))
      .map(c => {
        // Orden: primero los que tienen el apellido (o nombre) que EMPIEZA con lo buscado
        const ap = BuscadorClientesService.normalizar(c.apellido);
        const no = BuscadorClientesService.normalizar(c.nombre);
        const puntaje = ap.startsWith(primera) ? 0 : no.startsWith(primera) ? 1 : 2;
        return { c, puntaje, clave: `${ap} ${no}` };
      })
      .sort((a, b) => a.puntaje - b.puntaje || a.clave.localeCompare(b.clave))
      .slice(0, max)
      .map(x => x.c);
  }

  static armar(id: string, d: any): ClienteEncontrado & { _texto: string } {
    const c: ClienteEncontrado = {
      id,
      nombre: d.nombre || '',
      apellido: d.apellido || '',
      razonSocial: d.razonSocial || '',
      dni: d.dni ?? '',
      cuit: d.cuit ?? '',
      telefono: d.telefono || '',
      mail: d.mail || '',
      esMayorista: d.esMayorista === true,
      puntos: Number(d.puntos) || 0,
      data: d
    };
    const _texto = BuscadorClientesService.normalizar(
      [c.nombre, c.apellido, c.razonSocial, c.dni, c.cuit].join(' '));
    return { ...c, _texto };
  }

  private async asegurarCache() {
    const vigente = this.cache && (Date.now() - this.cache.leido) < BuscadorClientesService.VIGENCIA_MS;
    if (vigente) return;
    if (!this.cargando) {
      this.cargando = (async () => {
        const snap = await getDocs(collection(this.firestore, 'Clientes'));
        const clientes = snap.docs.map(d => BuscadorClientesService.armar(d.id, d.data()));
        this.cache = { clientes, leido: Date.now() };
      })().finally(() => this.cargando = null);
    }
    await this.cargando;
  }

  /** "Pérez, Juan · DNI 30123456" para mostrar en la lista */
  static etiqueta(c: ClienteEncontrado): string {
    const nombre = [c.apellido, c.nombre].filter(Boolean).join(', ') || c.razonSocial || 'Sin nombre';
    const doc = c.dni ? `DNI ${c.dni}` : c.cuit ? `CUIT ${c.cuit}` : '';
    return doc ? `${nombre} · ${doc}` : nombre;
  }
}
