import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators, FormArray } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Producto } from 'src/app/modules/shop/models/producto.model';
import { SucursalesService } from 'src/app/modules/admin/services/sucursales.service';

@Component({
  selector: 'app-edicion-producto',
  templateUrl: './edicion-producto.component.html',
  styleUrls: ['./edicion-producto.component.css']
})
export class EdicionProductoComponent {
  formProducto!: FormGroup;
  sucursales: { id: string; nombre: string }[] = [];

  constructor(
    private fb: FormBuilder,
    private dialogRef: MatDialogRef<EdicionProductoComponent>,
    @Inject(MAT_DIALOG_DATA) public producto: Producto,
    private sucursalesService: SucursalesService
  ) {}

  ngOnInit(): void {
    this.sucursalesService.obtenerSucursales().subscribe(sucursales => {
      this.sucursales = sucursales.map(s => ({ id: s.id, nombre: s.nombre }));
      this.crearFormulario();
    });
  }

  private crearFormulario(): void {
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

      stockMinimo: [this.producto.stockMinimo, [Validators.min(0)]],
      stockMayorista: [this.producto.stockMayorista || 0],

      stockSucursales: this.fb.array(
        this.sucursales.map(s => this.fb.group({
          sucursalId: [s.id],
          cantidad: [this.producto.stockSucursales?.find(ss => ss.sucursalId === s.id)?.cantidad || 0, [Validators.min(0)]]
        }))
      ),

      variantes: this.fb.array(
        (this.producto.variantes || []).map(v =>
          this.fb.group({
            color: [v.color || '#000000'],
            codigoBarras: [v.codigoBarras || ''],
            stockMayorista: [v.stockMayorista || 0],
            stockSucursales: this.fb.array(
              this.sucursales.map(s => this.fb.group({
                sucursalId: [s.id],
                cantidad: [v.stockSucursales?.find(ss => ss.sucursalId === s.id)?.cantidad || 0]
              }))
            )
          })
        )
      )
    });

    this.setupConditionalFields();
  }

  private setupConditionalFields(): void {
    const toggleControl = (control: string, condition: string) => {
      this.formProducto.get(condition)?.valueChanges.subscribe((checked: boolean) => {
        const ctrl = this.formProducto.get(control);
        checked ? ctrl?.enable() : ctrl?.disable();
      });
    };

    toggleControl('precioMinorista', 'ventaMinorista');
    toggleControl('precioMayorista', 'ventaMayorista');
    toggleControl('precioOferta', 'oferta');
  }

  agregarVariante(): void {
    const grupo = this.fb.group({
      color: ['#000000'],
      codigoBarras: [''],
      stockMayorista: [0],
      stockSucursales: this.fb.array(
        this.sucursales.map(s => this.fb.group({
          sucursalId: [s.id],
          cantidad: [0]
        }))
      )
    });
    this.variantesArray.push(grupo);
  }

  eliminarVariante(index: number): void {
    this.variantesArray.removeAt(index);
  }

  guardar(): void {
    if (this.formProducto.invalid) {
      this.formProducto.markAllAsTouched();
      return;
    }

    const valores = this.formProducto.getRawValue();

    const productoActualizado: Producto = {
      ...this.producto,
      ...valores,
      stockSucursales: valores.stockSucursales.map((s: any) => ({
        sucursalId: s.sucursalId,
        cantidad: Number(s.cantidad) || 0
      })),
      variantes: valores.variantes.map((v: any) => ({
        color: v.color,
        codigoBarras: v.codigoBarras,
        stockMayorista: Number(v.stockMayorista),
        stockSucursales: v.stockSucursales.map((s: any) => ({
          sucursalId: s.sucursalId,
          cantidad: Number(s.cantidad) || 0
        }))
      }))
    };

    this.dialogRef.close(productoActualizado);
  }

  get stockArray(): FormArray {
    return this.formProducto.get('stockSucursales') as FormArray;
  }

  get variantesArray(): FormArray {
    return this.formProducto.get('variantes') as FormArray;
  }

  getStockSucursales(index: number): FormArray {
    return this.variantesArray.at(index).get('stockSucursales') as FormArray;
  }
}
