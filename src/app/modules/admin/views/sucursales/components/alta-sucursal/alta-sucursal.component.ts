import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { Sucursal } from 'src/app/modules/admin/models/sucursal.model';
import { SucursalesService } from 'src/app/modules/admin/services/sucursales.service';

@Component({
  selector: 'app-alta-sucursal',
  templateUrl: './alta-sucursal.component.html',
  styleUrls: ['./alta-sucursal.component.css']
})
export class AltaSucursalComponent {

  sucursalForm: FormGroup;
  editMode = false;

  constructor(
    private fb: FormBuilder,
    private dialogRef: MatDialogRef<AltaSucursalComponent>,
    private sucursalesService: SucursalesService,
    @Inject(MAT_DIALOG_DATA) public data: { sucursal?: Sucursal }
  ) {
    this.sucursalForm = this.fb.group({
      nombre: [data?.sucursal?.nombre || '', Validators.required],
      direccion: [data?.sucursal?.direccion || '', Validators.required],
      telefono: [data?.sucursal?.telefono || ''],
      activa: [data?.sucursal?.activa ?? true]
    });
  }


  ngOnInit(): void {
    this.sucursalForm = this.fb.group({
      nombre: [this.data?.sucursal?.nombre || '', Validators.required],
      direccion: [this.data?.sucursal?.direccion || '', Validators.required],
      telefono: [this.data?.sucursal?.telefono || ''],
      activa: [this.data?.sucursal?.activa ?? true],
    });

    if (this.data?.sucursal) {
      this.editMode = true;
    }
  }

  async guardar() {
    if (this.sucursalForm.invalid) return;

    const sucursal: Sucursal = this.sucursalForm.value;

    if (this.data?.sucursal?.id) {
      await this.sucursalesService.actualizarSucursal(this.data.sucursal.id, sucursal);
    } else {
      await this.sucursalesService.agregarSucursal(sucursal);
    }

    this.dialogRef.close(true);
  }

  async onSubmit() {
    if (this.sucursalForm.invalid) return;

    if (this.editMode && this.data.sucursal?.id) {
      // 🔹 Editar
      await this.sucursalesService.actualizarSucursal(this.data.sucursal.id, this.sucursalForm.value);
    } else {
      // 🔹 Alta
      await this.sucursalesService.agregarSucursal(this.sucursalForm.value);
    }

    this.dialogRef.close(true);
  }

  cancelar() {
    this.dialogRef.close(false);
  }
}
