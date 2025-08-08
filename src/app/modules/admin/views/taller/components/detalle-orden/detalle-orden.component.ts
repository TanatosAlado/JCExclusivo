import { Component } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatDialogRef } from '@angular/material/dialog';
import { Firestore, collection, query, where, getDocs } from '@angular/fire/firestore';


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
    private firestore: Firestore
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
    const ordenesRef = collection(this.firestore, 'Ordenes Pendientes');
    const q = query(
      ordenesRef,
      where('numeroOrden', '==', Number(numeroOrden)), // convertir a número
      where('dniCliente', '==', Number(dni)) // también número
    );

    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
      this.mensajeError = 'No se encontró ninguna orden con esos datos.';
    } else {
      querySnapshot.forEach((doc) => {
        this.resultado = { id: doc.id, ...doc.data() };
      });
    }
  } catch (error) {
    console.error('Error buscando orden:', error);
    this.mensajeError = 'Ocurrió un error al buscar la orden.';
  } finally {
    this.buscando = false;
  }
}


}