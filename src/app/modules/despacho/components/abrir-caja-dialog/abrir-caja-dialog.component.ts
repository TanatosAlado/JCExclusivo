import { Component, Inject, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { SucursalesService } from 'src/app/modules/admin/services/sucursales.service';


@Component({
  selector: 'app-abrir-caja-dialog',
  templateUrl: './abrir-caja-dialog.component.html'
})
export class AbrirCajaDialogComponent implements OnInit {
  form!: FormGroup;
  sucursales: any[] = [];

  constructor(
    private fb: FormBuilder,
    private sucursalesService: SucursalesService,
    private dialogRef: MatDialogRef<AbrirCajaDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: any
  ) {}

  ngOnInit(): void {
    this.form = this.fb.group({
      sucursalId: [null, Validators.required],
      montoInicial: [null, [Validators.required, Validators.min(0)]]
    });

    this.sucursalesService.obtenerSucursales().subscribe(s => {
      this.sucursales = s;
    });
  }

  confirmar() {
    if (this.form.valid) {
      this.dialogRef.close(this.form.value);
    }
  }

  cancelar() {
    this.dialogRef.close();
  }
}