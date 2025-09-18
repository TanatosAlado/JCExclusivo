import { Component, Inject, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { FormBuilder, FormGroup } from '@angular/forms';
import { Sucursal } from 'src/app/modules/admin/models/sucursal.model';

@Component({
  selector: 'app-detalle-sucursal',
  templateUrl: './detalle-sucursal.component.html',
  styleUrls: ['./detalle-sucursal.component.css']
})
export class DetalleSucursalComponent {

  sucursalForm!: FormGroup;

  constructor(
    private fb: FormBuilder,
    private dialogRef: MatDialogRef<DetalleSucursalComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { sucursal: Sucursal }
  ) {}

  ngOnInit(): void {
    this.sucursalForm = this.fb.group({
      nombre: [{ value: this.data.sucursal.nombre, disabled: true }],
      direccion: [{ value: this.data.sucursal.direccion, disabled: true }],
      telefono: [{ value: this.data.sucursal.telefono || '-', disabled: true }],
      activa: [{ value: this.data.sucursal.activa ? 'Activa' : 'Inactiva', disabled: true }]
    });
  }

  cerrar() {
    this.dialogRef.close();
  }
}
