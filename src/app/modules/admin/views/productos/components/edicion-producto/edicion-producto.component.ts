import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import {MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Producto } from 'src/app/modules/shop/models/producto.model';

@Component({
  selector: 'app-edicion-producto',
  templateUrl: './edicion-producto.component.html',
  styleUrls: ['./edicion-producto.component.css']
})
export class EdicionProductoComponent {

  formProducto!: FormGroup;
constructor(
    private fb: FormBuilder,
    private dialogRef: MatDialogRef<EdicionProductoComponent>,
    @Inject(MAT_DIALOG_DATA) public producto: Producto
  ) {}

  
  ngOnInit(): void {
    this.formProducto = this.fb.group({
      nombre: [this.producto.nombre, Validators.required],
      descripcion: [this.producto.descripcion],
      rubro: [this.producto.rubro],
      subrubro: [this.producto.subrubro],
      marca: [this.producto.marca],
      precio: [this.producto.precioMinorista, [Validators.required, Validators.min(0)]],
      stock: [this.producto.stock, [Validators.required, Validators.min(0)]],
      destacado: [this.producto.destacado],
      oferta: [this.producto.oferta],
      precioOferta: [this.producto.precioOferta],
      imagen: [this.producto.imagen],
    });

    this.suscribirseACambios();
  }

   private suscribirseACambios(): void {
    this.formProducto.get('oferta')?.valueChanges.subscribe(oferta => {
      const precioOferta = this.formProducto.get('precioOferta');
      if (oferta) {
        precioOferta?.setValidators([Validators.required, Validators.min(0)]);
      } else {
        precioOferta?.clearValidators();
        precioOferta?.setValue(0);
      }
      precioOferta?.updateValueAndValidity();
    });

    this.formProducto.get('impuestoNacional')?.valueChanges.subscribe(impuesto => {
      const precioImpuesto = this.formProducto.get('precioImpuestoNacional');
      if (impuesto) {
        precioImpuesto?.setValidators([Validators.required, Validators.min(0)]);
      } else {
        precioImpuesto?.clearValidators();
        precioImpuesto?.setValue(0);
      }
      precioImpuesto?.updateValueAndValidity();
    });
  }

  guardar(): void {
    if (this.formProducto.invalid) {
      this.formProducto.markAllAsTouched();
      return;
    }

    const productoActualizado: Producto = {
      ...this.producto,
      ...this.formProducto.value
    };

    this.dialogRef.close(productoActualizado); // o enviá al backend desde aquí
  }
}


