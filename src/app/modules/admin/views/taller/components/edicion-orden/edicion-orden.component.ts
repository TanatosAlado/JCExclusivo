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
  estados = ['Pendiente', 'En Preparación', 'Finalizado', 'Entregado']
  constructor(private fb: FormBuilder, private dialogRef: MatDialogRef<EdicionOrdenComponent>,
    @Inject(MAT_DIALOG_DATA) public orden: any, private toastService: ToastService) {

    this.formOrdenes = this.fb.group({
      dniCliente: [orden.dniCliente],
      nombreCliente: [orden.nombreCliente],
      apellidoCliente: [orden.apellidoCliente],
      telefonoCliente: [orden.telefonoCliente],

      imei: [orden.imei],
      codigoDesbloqueo: [orden.codigoDesbloqueo || ''], // 👈 NUEVO

      equipo: [orden.equipo],
      motivoIngreso: [orden.motivoIngreso],
      presupuesto: [orden.presupuesto],

      // 🏛️ GREMIO
      esGremio: [orden.esGremio || false],
      gremioNombre: [{ value: orden.gremioNombre || '', disabled: !orden.esGremio }],

      garantia: [orden.garantia],
      diasGarantia: [{ value: orden.diasGarantia, disabled: !orden.garantia }],
      estado: [orden.estado],

      observaciones: [orden.observaciones?.join('\n') || ''],
      newObservacion: []
    });

    this.formOrdenes.get('garantia')!.valueChanges.subscribe((checked: boolean) => {
      const diasGarantiaControl = this.formOrdenes.get('diasGarantia');
      if (checked) {
        diasGarantiaControl!.enable();
      } else {
        diasGarantiaControl!.setValue(0);
        diasGarantiaControl!.disable();
      }
    });

    this.formOrdenes.get('esGremio')!.valueChanges.subscribe((esGremio: boolean) => {
      const gremioCtrl = this.formOrdenes.get('gremioNombre');

      if (esGremio) {
        gremioCtrl?.enable();
      } else {
        gremioCtrl?.reset();
        gremioCtrl?.disable();
      }
    });
  }

guardar(): void {
  if (this.formOrdenes.valid) {
    const fechaActual = new Date();
    const dia = String(fechaActual.getDate()).padStart(2, '0');
    const mes = String(fechaActual.getMonth() + 1).padStart(2, '0');
    const anio = fechaActual.getFullYear();
    const fechaFormateada = `${dia}/${mes}/${anio}`;
    const observacionesActuales = this.formOrdenes.get('observaciones')?.value
      .split('\n')
      .filter(o => o.trim() !== '');

    const nuevaObs = this.formOrdenes.get('newObservacion')?.value?.trim();
    if (nuevaObs) {
      observacionesActuales.push(`${fechaFormateada}: ${nuevaObs}`);
    }
    const ordenActualizada = {
      ...this.formOrdenes.getRawValue(),
      observaciones: observacionesActuales,
      newObservacion: '',
      id: this.orden.id
    };

    this.dialogRef.close(ordenActualizada);
    this.toastService.toastMessage("Orden actualizada con éxito", "green", 2000);
  }
}
}
