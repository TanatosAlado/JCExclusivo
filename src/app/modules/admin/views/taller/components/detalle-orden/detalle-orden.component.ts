import { Component } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatDialogRef } from '@angular/material/dialog';
import { Firestore, collection, query, where, getDocs } from '@angular/fire/firestore';
import { OrdenesService } from 'src/app/modules/admin/services/ordenes.service';


@Component({
  selector: 'app-detalle-orden',
  templateUrl: './detalle-orden.component.html',
  styleUrls: ['./detalle-orden.component.css']
})
export class DetalleOrdenComponent {
  consultaForm: FormGroup;
  resultado: any = null;
  buscando = false;
  mensajeError = '';

  constructor(
    private fb: FormBuilder,
    private dialogRef: MatDialogRef<DetalleOrdenComponent>,
    private firestore: Firestore,
    private ordenesService: OrdenesService
  ) {
    this.consultaForm = this.fb.group({
      numeroOrden: ['', Validators.required],
      dni: ['', Validators.required]
    });
  }

async buscar() {
  if (this.consultaForm.invalid) return;

  this.buscando = true;
  this.resultado = null;
  this.mensajeError = '';

  const { numeroOrden, dni } = this.consultaForm.value;

  try {
    const orden = await this.ordenesService.buscarOrdenPorNumeroYDni(
      Number(numeroOrden),
      Number(dni)
    );

    if (!orden) {
      this.mensajeError = 'No se encontró ninguna orden con esos datos.';
    } else {
      this.resultado = orden;
    }

  } catch {
    this.mensajeError = 'Ocurrió un error al buscar la orden.';
  } finally {
    this.buscando = false;
  }
}


}