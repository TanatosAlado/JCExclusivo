import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators, FormArray } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Producto } from 'src/app/modules/shop/models/producto.model';
import { SucursalesService } from 'src/app/modules/admin/services/sucursales.service';
import { Storage, ref, uploadBytes, getDownloadURL } from '@angular/fire/storage';
import { Auth } from '@angular/fire/auth';
import { ProductosService } from 'src/app/modules/shop/services/productos.service'; 


@Component({
  selector: 'app-edicion-producto',
  templateUrl: './edicion-producto.component.html',
  styleUrls: ['./edicion-producto.component.css']
})
export class EdicionProductoComponent {
  formProducto!: FormGroup;
  sucursales: { id: string; nombre: string }[] = [];
  variantesEliminadas: string[] = [];

  constructor(
    private storage: Storage ,
    private fb: FormBuilder,
    private dialogRef: MatDialogRef<EdicionProductoComponent>,
    @Inject(MAT_DIALOG_DATA) public producto: Producto,
    private sucursalesService: SucursalesService,
    private productosService: ProductosService,
      private auth: Auth   // 👈 AGREGAR

  ) {}

  ngOnInit(): void {

    this.sucursalesService.obtenerSucursales().subscribe(sucursales => {

      this.sucursales = sucursales.map(s => ({
        id: s.id,
        nombre: s.nombre
      }));

      // Primero creamos el formulario con los datos
      // del producto que estamos editando.
      this.crearFormulario();

      // 🔥 Buscamos el productoPadre real desde Firestore
      const productoPadre = (this.producto as any).productoPadre;

      if (!productoPadre) {
        console.log('ℹ️ El producto no pertenece a un grupo de variantes.');
        return;
      }

      console.log('🧩 Producto padre:', productoPadre);

      // 🔥 Buscamos TODAS las variantes reales
      this.productosService
        .obtenerVariantesPorProductoPadre(productoPadre)
        .then(variantes => {

          console.log('🎨 Variantes encontradas:', variantes);

          // FormArray de variantes del formulario
          const variantesArray = this.variantesArray;
          
          // Limpiamos las variantes que pudiera haber cargado
          // originalmente crearFormulario()
          variantesArray.clear();

          // 🔥 Agregamos las variantes reales de Firestore
          variantes.forEach((variante: any) => {
            const grupo = this.fb.group({
              id: [variante.id || null],
              modelo: [variante.modelo || null],
              color: [variante.color || '#000000'],
              codigoBarras: [variante.codigoBarras || ''],
              imagen: [variante.imagen || ''],
              stockMayorista: [
                Number(variante.stockMayorista || 0)
              ],

              stockSucursales: this.fb.array(
                this.sucursales.map(s => {
                  const stockExistente =
                    variante.stockSucursales?.find(
                      (ss: any) =>
                        ss.sucursalId === s.id
                    );

                  return this.fb.group({
                    sucursalId: [s.id],
                    cantidad: [
                      Number(stockExistente?.cantidad || 0)
                    ]
                  });
                })
              )
            });
            variantesArray.push(grupo);
          });
          console.log(
            '🧩 FormArray variantes cargado:',
            variantesArray.getRawValue()
          );
        })
        .catch(error => {

          console.error(
            '❌ Error obteniendo variantes:',
            error
          );
        });
    });
  }

private crearFormulario(): void {
  this.formProducto = this.fb.group({
    codigoBarras: [this.producto.codigoBarras, Validators.required],
    descripcion: [this.producto.descripcion, Validators.required],
    subdescripcion: [ (this.producto as any).subdescripcion || '' ], // si usás subdescripcion
    imagen: [this.producto.imagen],
    color: [ (this.producto as any).color || '#000000' ], // 🔹 CONTROL QUE FALTABA
    rubro: [this.producto.rubro, Validators.required],
    subrubro: [this.producto.subrubro, Validators.required],
    marca: [this.producto.marca, Validators.required],

    precioCosto: [this.producto.precioCosto, [Validators.required, Validators.min(0)]],
    precioSinImpuestos: [this.producto.precioSinImpuestos, [Validators.required, Validators.min(0)]],

    ventaMinorista: [this.producto.ventaMinorista ?? false],
    precioMinorista: [this.producto.precioMinorista],
    ventaMayorista: [this.producto.ventaMayorista ?? false],
    precioMayorista: [this.producto.precioMayorista],
    moneda: [this.producto.moneda || 'ARS'],

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
      (this.producto.variantes || []).map((v: any) =>
        this.fb.group({
          id: [v.id || null],
          modelo: [v.modelo || null],               // 🔹 soporte modelo (modelo+color)
          color: [v.color || '#000000'],
          codigoBarras: [v.codigoBarras || ''],
          imagen: [v.imagen || ''],
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
    id: [null],
    modelo: [null],            // opcional
    color: ['#000000'],
    codigoBarras: [''],
    imagen: [''],
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


    // La quitamos inmediatamente del formulario.
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
      moneda: valores.moneda || 'ARS',

      // Stock general del producto
      stockSucursales: valores.stockSucursales.map((s: any) => ({
        sucursalId: s.sucursalId,
        cantidad: Number(s.cantidad) || 0
      })),

      // Variantes
      variantes: valores.variantes.map((v: any) => ({

        // 🔥 IMPORTANTE:
        // Si la variante ya existía, conserva su ID.
        // Si fue agregada desde "+ Agregar Variante",
        // tendrá id = null y quedará como undefined.
        id: v.id || undefined,

        modelo: v.modelo || null,
        color: v.color || '#000000',
        codigoBarras: v.codigoBarras || '',
        imagen: v.imagen || null,

        stockMayorista: Number(v.stockMayorista) || 0,

        stockSucursales: (v.stockSucursales || []).map((s: any) => ({
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

  async onImagenSeleccionada(event: any) {
    const file: File = event.target.files[0];
    if (!file) return;

    try {
      const nombreArchivo = `productos/${Date.now()}_${file.name}`;
      const storageRef = ref(this.storage, nombreArchivo);

      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);

      this.formProducto.get('imagen')?.setValue(url);

    } catch (error) {
      console.error('Error subiendo imagen', error);
    }
  }


}
