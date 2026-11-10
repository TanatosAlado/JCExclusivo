import { Component, OnInit } from '@angular/core';
import Swal from 'sweetalert2';
import { SECCIONES, SECCIONES_EXCLUSIVAS, PERMISOS_POR_DEFECTO, Seccion } from 'src/app/core/secciones';
import { PermisosService } from 'src/app/core/permisos.service';
import { AdminPermisos, PermisosError, PermisosUsuariosService } from '../../services/permisos-usuarios.service';

/**
 * Permisos de usuarios (solo superadministrador): qué secciones ve cada administrador.
 * Solo aparecen los usuarios que ya son administradores.
 */
@Component({
  selector: 'app-permisos-usuarios',
  templateUrl: './permisos-usuarios.component.html',
  styleUrls: ['./permisos-usuarios.component.css']
})
export class PermisosUsuariosComponent implements OnInit {

  readonly secciones: Seccion[] = SECCIONES;
  readonly exclusivas = SECCIONES_EXCLUSIVAS;

  admins: AdminPermisos[] = [];
  cargando = true;
  guardando = false;
  filtro = '';
  miUid: string | null = null;

  seleccionado: AdminPermisos | null = null;
  // Edición en curso
  superAdmin = false;
  marcados = new Set<string>();

  constructor(private servicio: PermisosUsuariosService, private permisos: PermisosService) { }

  async ngOnInit() {
    this.miUid = await this.permisos.uidActual();
    await this.cargar();
  }

  async cargar(mantenerId?: string) {
    this.cargando = true;
    try {
      this.admins = await this.servicio.listarAdmins();
      const id = mantenerId || this.seleccionado?.id;
      const elegido = id ? this.admins.find(a => a.id === id) : null;
      if (elegido) this.elegir(elegido, true);
    } catch (e: any) {
      console.error(e);
      Swal.fire('Error', 'No se pudieron cargar los administradores. ' + (e?.message || ''), 'error');
    } finally {
      this.cargando = false;
    }
  }

  get visibles(): AdminPermisos[] {
    const t = this.filtro.trim().toLowerCase();
    return this.admins.filter(a => !t || `${a.usuario} ${a.nombre} ${a.mail}`.toLowerCase().includes(t));
  }

  async elegir(a: AdminPermisos, forzar = false) {
    if (!forzar && this.hayCambios && this.seleccionado?.id !== a.id) {
      const r = await Swal.fire({
        title: 'Hay cambios sin guardar', text: '¿Descartarlos?', icon: 'question',
        showCancelButton: true, confirmButtonText: 'Descartar', cancelButtonText: 'Seguir editando'
      });
      if (!r.isConfirmed) return;
    }
    this.seleccionado = a;
    this.superAdmin = a.superAdmin;
    this.marcados = new Set(a.permisos);
  }

  // ---------- Estado de la edición ----------

  get soloLectura(): boolean {
    return !this.seleccionado || this.seleccionado.dueno;
  }

  get esYo(): boolean {
    return !!this.seleccionado && this.seleccionado.id === this.miUid;
  }

  /** Un superadmin ve todo: los tildes de secciones no aplican */
  get seccionesBloqueadas(): boolean {
    return this.soloLectura || this.superAdmin;
  }

  get hayCambios(): boolean {
    const a = this.seleccionado;
    if (!a || a.dueno) return false;
    if (a.superAdmin !== this.superAdmin) return true;
    return a.permisos.length !== this.marcados.size || a.permisos.some(p => !this.marcados.has(p));
  }

  marcado(clave: string): boolean {
    return this.superAdmin || this.marcados.has(clave);
  }

  alternar(clave: string) {
    if (this.seccionesBloqueadas) return;
    if (this.marcados.has(clave)) this.marcados.delete(clave); else this.marcados.add(clave);
    this.marcados = new Set(this.marcados);
  }

  todas() { if (!this.seccionesBloqueadas) this.marcados = new Set(SECCIONES.map(s => s.clave)); }
  ninguna() { if (!this.seccionesBloqueadas) this.marcados = new Set(); }
  porDefecto() { if (!this.seccionesBloqueadas) this.marcados = new Set(PERMISOS_POR_DEFECTO); }

  descartar() {
    if (this.seleccionado) this.elegir(this.seleccionado, true);
  }

  async guardar() {
    const a = this.seleccionado;
    if (!a || this.soloLectura || !this.hayCambios || this.guardando) return;

    if (!this.superAdmin && this.marcados.size === 0) {
      const r = await Swal.fire({
        title: 'Sin secciones', icon: 'warning', showCancelButton: true,
        text: `${a.usuario || a.nombre} no va a poder entrar a ninguna sección del panel. ¿Guardar igual?`,
        confirmButtonText: 'Guardar', cancelButtonText: 'Volver'
      });
      if (!r.isConfirmed) return;
    }
    if (this.superAdmin && !a.superAdmin) {
      const r = await Swal.fire({
        title: `¿Hacer superadministrador a ${a.usuario || a.nombre}?`, icon: 'warning', showCancelButton: true,
        text: 'Va a ver todas las secciones y podrá cambiar los permisos de los demás (salvo los del dueño).',
        confirmButtonText: 'Sí, hacerlo superadmin', cancelButtonText: 'Cancelar'
      });
      if (!r.isConfirmed) return;
    }

    this.guardando = true;
    try {
      await this.servicio.guardar(a, { superAdmin: this.superAdmin, permisos: [...this.marcados] });
      Swal.fire({ toast: true, position: 'top-end', timer: 2000, showConfirmButton: false, icon: 'success', title: 'Permisos guardados' });
      await this.cargar(a.id);
    } catch (e: any) {
      if (e instanceof PermisosError) Swal.fire('No se puede', e.message, 'warning');
      else { console.error(e); Swal.fire('Error', 'No se pudieron guardar los permisos. ' + (e?.message || ''), 'error'); }
    } finally {
      this.guardando = false;
    }
  }

  resumen(a: AdminPermisos): string {
    if (a.superAdmin) return 'Todas las secciones';
    if (!a.permisos.length) return 'Sin secciones';
    return `${a.permisos.length} de ${SECCIONES.length} secciones${a.porDefecto ? ' (por defecto)' : ''}`;
  }
}
