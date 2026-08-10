import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Marquesina } from 'src/app/modules/admin/models/marquesina.model';
import { ToastService } from 'src/app/shared/services/toast.service';

@Component({
  selector: 'app-editar-marquesina',
  templateUrl: './editar-marquesina.component.html',
  styleUrls: ['./editar-marquesina.component.css']
})
export class EditarMarquesinaComponent {

  formMarquesina: FormGroup;

  constructor(
    private fb: FormBuilder,
    private dialogRef: MatDialogRef<EditarMarquesinaComponent>, @Inject(MAT_DIALOG_DATA) public marq: Marquesina, private toastService: ToastService) {
    this.formMarquesina = this.fb.group({
      mensaje: [marq.mensaje, Validators.required],
      tipoCliente: [marq.tipoCliente, Validators.required],
    })
  }

 async onSubmit() {
    if (this.formMarquesina.invalid) return;
    const data = this.formMarquesina.value;
    const actualizado: Marquesina = {
      ...this.marq,
      mensaje: data.mensaje,
      tipoCliente: data.tipoCliente,
    };
    this.toastService.toastMessage('Marquesina actualizada con éxito', 'green', 2000);
    this.dialogRef.close(actualizado);

  }
}
