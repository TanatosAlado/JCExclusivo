import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { ToastService } from 'src/app/shared/services/toast.service';

@Component({
  selector: 'app-clientes-editar',
  templateUrl: './clientes-editar.component.html',
  styleUrls: ['./clientes-editar.component.css']
})
export class ClientesEditarComponent {
  formCliente: FormGroup;

  constructor(private toastService:ToastService,    private fb: FormBuilder,
  private dialogRef: MatDialogRef<ClientesEditarComponent>,
  @Inject(MAT_DIALOG_DATA) public cliente: any){
    
    this.formCliente = this.fb.group({
      razonSocial: [cliente.razonSocial],
      direccion: [cliente.direccion],
      telefono: [cliente.telefono],
      estado: [cliente.estado ??false],
      administrador: [cliente.administrador ??false],
      esMayorista:[cliente.esMayorista ??false]
    });

  }

guardar(): void {
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
