import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
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
      codigoBarras: [this.producto.codigoBarras, Validators.required],
      descripcion: [this.producto.descripcion, Validators.required],
      imagen: [this.producto.imagen],
      rubro: [this.producto.rubro, Validators.required],
      subrubro: [this.producto.subrubro, Validators.required],
      marca: [this.producto.marca, Validators.required],

      precioCosto: [this.producto.precioCosto, [Validators.required, Validators.min(0)]],
      precioSinImpuestos: [this.producto.precioSinImpuestos, [Validators.required, Validators.min(0)]],

      ventaMinorista: [this.producto.ventaMinorista ?? false],
      precioMinorista: [this.producto.precioMinorista],
      ventaMayorista: [this.producto.ventaMayorista ?? false],
      precioMayorista: [this.producto.precioMayorista],

      oferta: [this.producto.oferta ?? false],
      precioOferta: [this.producto.precioOferta],
      destacado: [this.producto.destacado ?? false],

      stock: [this.producto.stock, [Validators.required, Validators.min(0)]],
      stockMinimo: [this.producto.stockMinimo, [Validators.min(0)]],
    });

    this.setupConditionalFields();
  }

  private setupConditionalFields(): void {
    this.formProducto.get('ventaMinorista')?.valueChanges.subscribe((checked: boolean) => {
      const ctrl = this.formProducto.get('precioMinorista');
      checked ? ctrl?.enable() : ctrl?.disable();
    });

    this.formProducto.get('ventaMayorista')?.valueChanges.subscribe((checked: boolean) => {
      const ctrl = this.formProducto.get('precioMayorista');
      checked ? ctrl?.enable() : ctrl?.disable();
    });

    this.formProducto.get('oferta')?.valueChanges.subscribe((checked: boolean) => {
      const ctrl = this.formProducto.get('precioOferta');
      checked ? ctrl?.enable() : ctrl?.disable();
    });

    // Inicializar controles deshabilitados si corresponde
    if (!this.formProducto.get('ventaMinorista')?.value) {
      this.formProducto.get('precioMinorista')?.disable();
    }
    if (!this.formProducto.get('ventaMayorista')?.value) {
      this.formProducto.get('precioMayorista')?.disable();
    }
    if (!this.formProducto.get('oferta')?.value) {
      this.formProducto.get('precioOferta')?.disable();
    }
  }

  guardar(): void {
    if (this.formProducto.invalid) {
      this.formProducto.markAllAsTouched();
      return;
    }

    const valores = this.formProducto.getRawValue();
    const productoActualizado: Producto = {
      ...this.producto,
      ...valores
    };

    this.dialogRef.close(productoActualizado);
  }
}