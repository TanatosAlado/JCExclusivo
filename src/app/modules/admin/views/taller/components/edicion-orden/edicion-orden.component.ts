import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { ToastService } from 'src/app/shared/services/toast.service';

@Component({
  selector: 'app-edicion-orden',
  templateUrl: './edicion-orden.component.html',
  styleUrls: ['./edicion-orden.component.css']
})
export class EdicionOrdenComponent {

  formOrdenes: FormGroup;
  constructor(private fb: FormBuilder,private dialogRef: MatDialogRef<EdicionOrdenComponent>,
    @Inject(MAT_DIALOG_DATA) public orden: any, private toastService:ToastService){

      this.formOrdenes = this.fb.group({
      dniCliente:[orden.dniCliente],  
      nombreCliente: [orden.nombreCliente],
      apellidoCliente: [orden.apellidoCliente],
      telefonoCliente: [orden.telefonoCliente],
      imei: [orden.imei],
      equipo: [orden.equipo],
      motivoIngreso:[orden.motivoIngreso],
      presupuesto:[orden.presupuesto],
      garantia:[orden.garantia],
      observaciones:[orden.observaciones]
        });
  }    

  guardar(): void {
  if (this.formOrdenes.valid) {
    const ordenActualizada = {
      ...this.formOrdenes.value,
      id: this.orden.id
    };
    this.dialogRef.close(ordenActualizada);
  }
  this.toastService.toastMessage("Orden ctualizado con Exito","green",2000)
}
}
