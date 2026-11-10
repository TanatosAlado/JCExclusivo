import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { ToastService } from 'src/app/shared/services/toast.service';
import { PermisosService } from 'src/app/core/permisos.service';

@Component({
  selector: 'app-clientes-editar',
  templateUrl: './clientes-editar.component.html',
  styleUrls: ['./clientes-editar.component.css']
})
export class ClientesEditarComponent {
  formCliente: FormGroup;
  /** Mensaje cuando el usuario logueado no puede cambiar permisos de este cliente */
  avisoPermisos = '';

  constructor(private toastService:ToastService,    private fb: FormBuilder,
  private dialogRef: MatDialogRef<ClientesEditarComponent>,
  @Inject(MAT_DIALOG_DATA) public cliente: any,
  private permisos: PermisosService){
    
    this.formCliente = this.fb.group({
      razonSocial: [cliente.razonSocial],
      direccion: [cliente.direccion],
      telefono: [cliente.telefono],
      estado: [cliente.estado ??false],
      administrador: [cliente.administrador ??false],
      esMayorista:[cliente.esMayorista ??false]
    });

    this.aplicarPermisos();
  }

  /**
   * Solo el superadministrador da o quita permisos de administrador.
   * Un administrador común tampoco puede habilitar/deshabilitar a otro administrador
   * ni modificar a un superadministrador (lo bloquean también las reglas de Firestore).
   * Los campos deshabilitados no se envían al guardar, así que no se modifican.
   */
  private async aplicarPermisos() {
    // Mientras se verifica, bloqueado
    this.formCliente.get('administrador')?.disable();
    let superAdmin = false;
    try { superAdmin = await this.permisos.esSuperAdmin(); } catch { }
    if (this.cliente.dueno === true) {
      // Al dueño nadie le cambia permisos ni lo deshabilita desde la app
      this.formCliente.get('estado')?.disable();
      this.avisoPermisos = 'Es el dueño: sus permisos y su habilitación no se pueden cambiar desde la app.';
      if (!superAdmin) { this.formCliente.disable(); }
      return;
    }
    if (superAdmin) {
      this.formCliente.get('administrador')?.enable();
      this.avisoPermisos = 'Las secciones que ve cada administrador se configuran en Gestiones → Permisos de usuarios.';
      return;
    }
    if (this.cliente.superAdmin === true) {
      this.formCliente.disable();
      this.avisoPermisos = 'Este usuario es superadministrador: solo lo puede modificar otro superadministrador.';
    } else if (this.cliente.administrador === true) {
      this.formCliente.get('estado')?.disable();
      this.avisoPermisos = 'Solo el superadministrador puede habilitar o quitar permisos a un administrador.';
    } else {
      this.avisoPermisos = 'Solo el superadministrador puede dar permisos de administrador.';
    }
  }

guardar(): void {
  if (this.formCliente.disabled) { this.dialogRef.close(); return; }
  if (this.formCliente.valid) {
    const clienteActualizado = {
      ...this.formCliente.value,
      id: this.cliente.id
    };
    this.dialogRef.close(clienteActualizado);
  }
  this.toastService.toastMessage("Cliente actualizado con Exito","green",2000)
}

}
