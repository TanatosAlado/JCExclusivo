import { Component, OnInit } from '@angular/core';
import { Firestore, collection, query, where, orderBy, limit, getDocs, Timestamp } from '@angular/fire/firestore';

interface RegistroAuditoria {
  id: string;
  fecha: Date | null;
  usuario: string;
  nombre: string;
  ip: string | null;
  navegador: string;
  accion: string;
  entidad: string;
  entidadId: string | null;
  descripcion: string;
  cambios?: { [campo: string]: { antes: any; despues: any } };
  datosEliminados?: any;
  extra?: any;
}

/**
 * Consulta del registro de auditoría (solo lectura).
 * Los registros no se pueden modificar ni borrar: lo garantizan las reglas de Firestore.
 */
@Component({
  selector: 'app-auditoria',
  templateUrl: './auditoria.component.html',
  styleUrls: ['./auditoria.component.css']
})
export class AuditoriaComponent implements OnInit {

  readonly MAXIMO = 1000;

  desde: Date = new Date();
  hasta: Date = new Date();

  filtroUsuario = '';
  filtroAccion = '';
  filtroEntidad = '';
  filtroTexto = '';

  registros: RegistroAuditoria[] = [];
  filtrados: RegistroAuditoria[] = [];
  usuarios: string[] = [];
  acciones: string[] = [];
  entidades: string[] = [];

  expandido: string | null = null;
  cargando = false;
  error = '';
  limiteAlcanzado = false;

  constructor(private firestore: Firestore) { }

  ngOnInit(): void {
    this.buscar();
  }

  async buscar() {
    const inicio = new Date(this.desde);
    inicio.setHours(0, 0, 0, 0);
    const fin = new Date(this.hasta);
    fin.setHours(23, 59, 59, 999);

    if (inicio > fin) {
      this.error = 'La fecha "desde" no puede ser posterior a "hasta".';
      return;
    }

    this.cargando = true;
    this.error = '';
    this.expandido = null;

    try {
      const q = query(
        collection(this.firestore, 'Auditoria'),
        where('fecha', '>=', Timestamp.fromDate(inicio)),
        where('fecha', '<=', Timestamp.fromDate(fin)),
        orderBy('fecha', 'desc'),
        limit(this.MAXIMO)
      );
      const snap = await getDocs(q);

      this.registros = snap.docs.map(d => {
        const data: any = d.data();
        return {
          id: d.id,
          fecha: data.fecha?.toDate ? data.fecha.toDate() : null,
          usuario: data.usuario || '',
          nombre: data.nombre || '',
          ip: data.ip || null,
          navegador: data.navegador || '',
          accion: data.accion || '',
          entidad: data.entidad || '',
          entidadId: data.entidadId || null,
          descripcion: data.descripcion || '',
          cambios: data.cambios,
          datosEliminados: data.datosEliminados,
          extra: data.extra
        };
      });
      this.limiteAlcanzado = snap.size >= this.MAXIMO;

      this.usuarios = this.unicos(this.registros.map(r => r.usuario));
      this.acciones = this.unicos(this.registros.map(r => r.accion));
      this.entidades = this.unicos(this.registros.map(r => r.entidad));

      this.aplicarFiltros();
    } catch (err: any) {
      console.error('Error consultando auditoría:', err);
      this.error = 'No se pudo consultar la auditoría. ' + (err?.message || '');
      this.registros = [];
      this.filtrados = [];
    } finally {
      this.cargando = false;
    }
  }

  aplicarFiltros() {
    const texto = this.filtroTexto.trim().toLowerCase();
    this.filtrados = this.registros.filter(r =>
      (!this.filtroUsuario || r.usuario === this.filtroUsuario) &&
      (!this.filtroAccion || r.accion === this.filtroAccion) &&
      (!this.filtroEntidad || r.entidad === this.filtroEntidad) &&
      (!texto || `${r.descripcion} ${r.nombre} ${r.entidadId || ''}`.toLowerCase().includes(texto))
    );
  }

  limpiarFiltros() {
    this.filtroUsuario = '';
    this.filtroAccion = '';
    this.filtroEntidad = '';
    this.filtroTexto = '';
    this.aplicarFiltros();
  }

  alternar(r: RegistroAuditoria) {
    this.expandido = this.expandido === r.id ? null : r.id;
  }

  tieneDetalle(r: RegistroAuditoria): boolean {
    return !!(r.cambios || r.datosEliminados || r.extra);
  }

  listaCambios(r: RegistroAuditoria): { campo: string; antes: string; despues: string }[] {
    return Object.entries(r.cambios || {}).map(([campo, v]) => ({
      campo,
      antes: this.mostrar(v?.antes),
      despues: this.mostrar(v?.despues)
    }));
  }

  mostrar(valor: any): string {
    if (valor === null || valor === undefined || valor === '') return '—';
    if (typeof valor === 'object') return JSON.stringify(valor, null, 1);
    return String(valor);
  }

  claseAccion(accion: string): string {
    switch (accion) {
      case 'crear': case 'venta': case 'abrir caja': return 'bg-success';
      case 'modificar': case 'mover': return 'bg-primary';
      case 'eliminar': case 'anular': return 'bg-danger';
      case 'cerrar caja': return 'bg-dark';
      default: return 'bg-secondary';
    }
  }

  private unicos(valores: string[]): string[] {
    return [...new Set(valores.filter(Boolean))].sort();
  }
}
