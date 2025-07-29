import { Component, Inject } from '@angular/core';
import { FormArray, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Producto } from 'src/app/modules/shop/models/producto.model';

@Component({
  selector: 'app-edicion-producto',
  templateUrl: './edicion-producto.component.html',
  styleUrls: ['./edicion-producto.component.css']
})
export class EdicionProductoComponent {

  formProducto!: FormGroup;
  productoForm: any;
  constructor(
    private fb: FormBuilder,
    private dialogRef: MatDialogRef<EdicionProductoComponent>,
    @Inject(MAT_DIALOG_DATA) public producto: Producto
  ) { }


  ngOnInit(): void {
    this.formProducto = this.fb.group({
      nombre: [this.producto.nombre, Validators.required],
      descripcion: [this.producto.descripcion],
      rubro: [this.producto.rubro],
      subrubro: [this.producto.subrubro],
      marca: [this.producto.marca],
      precioMinorista: [this.producto.precioMinorista, [Validators.required, Validators.min(0)]],
      precioMayorista: [this.producto.precioMayorista, [Validators.required, Validators.min(0)]],
      stock: [this.producto.stock, [Validators.required, Validators.min(0)]],
      destacado: [this.producto.destacado],
      oferta: [this.producto.oferta],
      precioOferta: [this.producto.precioOferta],
      imagen: [this.producto.imagen],
      ventaMinorista: [this.producto.ventaMinorista ?? false],
      ventaMayorista: [this.producto.ventaMayorista ?? false],
      tieneVariantes: [this.producto.tieneVariantes ?? false],
      variantes: this.fb.array([]),
    });

    this.suscribirseACambios();
      if (this.producto.variantes && this.producto.variantes.length) {
    this.cargarVariantes(this.producto.variantes);
  }
  }

  private suscribirseACambios(): void {
    this.formProducto.get('oferta')?.valueChanges.subscribe(oferta => {
      const precioOferta = this.formProducto.get('precioOferta');
      if (oferta) {
        precioOferta?.setValidators([Validators.required, Validators.min(0)]);
        precioOferta?.enable();
      } else {
        precioOferta?.clearValidators();
        precioOferta?.setValue(0);
        precioOferta?.disable();
      }
      precioOferta?.updateValueAndValidity();
    });

    this.formProducto.get('ventaMinorista')?.valueChanges.subscribe((checked: boolean) => {
      const control = this.formProducto.get('precioMinorista');
      if (checked) {
        control?.enable();
      } else {
        control?.setValue(0);
        control?.disable();
      }
    });

    this.formProducto.get('ventaMayorista')?.valueChanges.subscribe((checked: boolean) => {
      const control = this.formProducto.get('precioMayorista');
      if (checked) {
        control?.enable();
      } else {
        control?.setValue(0);
        control?.disable();
      }
    });

    this.formProducto.get('tieneVariantes')?.valueChanges.subscribe((checked: boolean) => {
  if (!checked) {
    while (this.variantes.length !== 0) {
      this.variantes.removeAt(0);
    }
  }
});

    if (!this.formProducto.get('ventaMinorista')?.value) {
      this.formProducto.get('precioMinorista')?.setValue(0);
      this.formProducto.get('precioMinorista')?.disable();
    }

    if (!this.formProducto.get('ventaMayorista')?.value) {
      this.formProducto.get('precioMayorista')?.setValue(0);
      this.formProducto.get('precioMayorista')?.disable();
    }

    if (!this.formProducto.get('oferta')?.value) {
      this.formProducto.get('precioOferta')?.setValue(0);
      this.formProducto.get('precioOferta')?.disable();
    }
  }

  guardar(): void {
    if (this.formProducto.invalid) {
      this.formProducto.markAllAsTouched();
      return;
    }
    const valoresCompletos = this.formProducto.getRawValue();

    const productoActualizado: Producto = {
      ...this.producto,
      ...valoresCompletos
    };

    this.dialogRef.close(productoActualizado);
  }
get variantes(): FormArray {
  return this.formProducto.get('variantes') as FormArray;
}

private cargarVariantes(variantesData: any[]): void {
  variantesData.forEach(v => {
    this.variantes.push(this.fb.group({
      nombre: [v.nombre, Validators.required],
      valor: [v.valor, Validators.required],
      stock: [v.stock, [Validators.required, Validators.min(0)]],
    }));
  });
}
  agregarVariante() {
    this.variantes.push(this.fb.group({
      nombre: ['', Validators.required],
      valor: ['#000000', Validators.required], // Color visual
      stock: [0, [Validators.required, Validators.min(0)]],
    }));
  }

  eliminarVariante(index: number) {
    this.variantes.removeAt(index);
  }
  // guardar(): void {
  //   if (this.formProducto.invalid) {
  //     this.formProducto.markAllAsTouched();
  //     return;
  //   }

  //   const productoActualizado: Producto = {
  //     ...this.producto,
  //     ...this.formProducto.value
  //   };

  //   this.dialogRef.close(productoActualizado); 
  // }
}


