import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import Swal from 'sweetalert2';
import { Cajero, CajeroError, CajerosService, nombreCajero } from '../../services/cajeros.service';

/**
 * Gestión de cajeros: alta, edición y baja (no se borran, se dan de baja).
 * Los cajeros activos se eligen en Despacho al cerrar cada venta.
 */
@Component({
  selector: 'app-cajeros',
  templateUrl: './cajeros.component.html',
  styleUrls: ['./cajeros.component.css']
})
export class CajerosComponent implements OnInit, OnDestroy {

  cajeros: Cajero[] = [];
  cargando = true;
  guardando = false;
  verInactivos = false;
  filtro = '';

  // Formulario (alta o edición)
  editando: Cajero | null = null;
  form = { nombre: '', apellido: '', dni: '' as any };

  private sub?: Subscription;

  constructor(private cajerosService: CajerosService) { }

  ngOnInit(): void {
    this.sub = this.cajerosService.listar().subscribe({
      next: lista => { this.cajeros = lista; this.cargando = false; },
      error: e => { console.error(e); this.cargando = false; }
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  get visibles(): Cajero[] {
    const t = this.filtro.trim().toLowerCase();
    return this.cajeros
      .filter(c => this.verInactivos || c.activo !== false)
      .filter(c => !t || `${c.nombre} ${c.apellido} ${c.dni}`.toLowerCase().includes(t));
  }

  get cantidadActivos(): number {
    return this.cajeros.filter(c => c.activo !== false).length;
  }

  get cantidadInactivos(): number {
    return this.cajeros.length - this.cantidadActivos;
  }

  nombre(c: Cajero): string {
    return nombreCajero(c);
  }

  editar(c: Cajero) {
    this.editando = c;
    this.form = { nombre: c.nombre, apellido: c.apellido, dni: c.dni };
  }

  cancelarEdicion() {
    this.editando = null;
    this.form = { nombre: '', apellido: '', dni: '' };
  }

  async guardar() {
    if (this.guardando) return;
    this.guardando = true;
    try {
      if (this.editando) {
        await this.cajerosService.actualizar(this.editando, this.form);
        this.aviso('Cajero actualizado');
      } else {
        await this.cajerosService.crear(this.form);
        this.aviso('Cajero dado de alta');
      }
      this.cancelarEdicion();
    } catch (e: any) {
      if (e instanceof CajeroError) Swal.fire('Revisá los datos', e.message, 'warning');
      else { console.error(e); Swal.fire('Error', 'No se pudo guardar. ' + (e?.message || ''), 'error'); }
    } finally {
      this.guardando = false;
    }
  }

  async darDeBaja(c: Cajero) {
    const r = await Swal.fire({
      title: `¿Dar de baja a ${this.nombre(c)}?`,
      text: 'No va a aparecer más para elegir en Despacho. Sus ventas quedan registradas y lo podés reactivar cuando quieras.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Dar de baja',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#d33'
    });
    if (!r.isConfirmed) return;
    try {
      await this.cajerosService.darDeBaja(c);
      if (this.editando?.id === c.id) this.cancelarEdicion();
      this.aviso('Cajero dado de baja');
    } catch (e: any) {
      Swal.fire('Error', e?.message || 'No se pudo dar de baja.', 'error');
    }
  }

  async reactivar(c: Cajero) {
    try {
      await this.cajerosService.reactivar(c);
      this.aviso('Cajero reactivado');
    } catch (e: any) {
      Swal.fire('No se pudo reactivar', e?.message || '', 'warning');
    }
  }

  private aviso(titulo: string) {
    Swal.fire({ toast: true, position: 'top-end', timer: 2000, showConfirmButton: false, icon: 'success', title: titulo });
  }
}
