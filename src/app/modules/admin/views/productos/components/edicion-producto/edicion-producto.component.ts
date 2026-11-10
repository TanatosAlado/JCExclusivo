import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators, FormArray } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Producto } from 'src/app/modules/shop/models/producto.model';
import { SucursalesService } from 'src/app/modules/admin/services/sucursales.service';
import { Storage, ref, uploadBytes, getDownloadURL } from '@angular/fire/storage';
import { Auth } from '@angular/fire/auth';
import { ProductosService } from 'src/app/modules/shop/services/productos.service'; 
import { firstValueFrom } from 'rxjs';
import { take } from 'rxjs/operators';
import Swal from 'sweetalert2';
import { nombreColor } from 'src/app/shared/utils/colores';
import { fotosDe } from 'src/app/shared/utils/fotos';


@Component({
  selector: 'app-edicion-producto',
  templateUrl: './edicion-producto.component.html',
  styleUrls: ['./edicion-producto.component.css']
})
export class EdicionProductoComponent {
  formProducto!: FormGroup;
  sucursales: { id: string; nombre: string }[] = [];
  /** Variantes que el usuario quitó a propósito (son las ÚNICAS que se eliminan al guardar) */
  variantesEliminadas: string[] = [];

  /** Mientras cargan las variantes de Firestore no se puede guardar (si no, se perderían) */
  cargandoVariantes = false;
  errorVariantes: string | null = null;
  /** Mientras se sube la foto no se puede guardar (si no, la foto nueva no se guarda) */
  subiendoImagen = false;
  /** Fotos del producto (varias; la primera es la principal). Se suben al elegirlas. */
  fotosProducto: string[] = [];

  constructor(
    private storage: Storage ,
    private fb: FormBuilder,
    private dialogRef: MatDialogRef<EdicionProductoComponent>,
    @Inject(MAT_DIALOG_DATA) public producto: Producto,
    private sucursalesService: SucursalesService,
    private productosService: ProductosService,
      private auth: Auth   // 👈 AGREGAR

  ) {}

  async ngOnInit(): Promise<void> {
    const productoPadre = (this.producto as any).productoPadre;
    this.cargandoVariantes = !!productoPadre;

    // Las sucursales se leen UNA vez: antes se escuchaban "en vivo" y cada vez que
    // llegaban de nuevo se rehacía todo el formulario (se perdían la foto nueva y las variantes).
    try {
      const sucursales = await firstValueFrom(this.sucursalesService.obtenerSucursales().pipe(take(1)));
      this.sucursales = (sucursales || []).map(s => ({ id: s.id, nombre: s.nombre }));
    } catch (error) {
      console.error('❌ Error obteniendo sucursales:', error);
      this.sucursales = [];
    }

    this.crearFormulario();

    if (!productoPadre) {
      return; // producto sin variantes
    }

    // Variantes reales (cada variante es un documento con el mismo productoPadre)
    try {
      const variantes = await this.productosService.obtenerVariantesPorProductoPadre(productoPadre);
      const variantesArray = this.variantesArray;
      variantesArray.clear();

      variantes.forEach((variante: any) => {
        variantesArray.push(this.fb.group({
          id: [variante.id || null],
          modelo: [variante.modelo || null],
          color: [variante.color || '#000000'],
          codigoBarras: [variante.codigoBarras || ''],
          imagen: [variante.imagen || ''],
          stockMayorista: [Number(variante.stockMayorista || 0)],
          stockSucursales: this.fb.array(
            this.sucursales.map(s => {
              const stockExistente = variante.stockSucursales?.find((ss: any) => ss.sucursalId === s.id);
              return this.fb.group({
                sucursalId: [s.id],
                cantidad: [Number(stockExistente?.cantidad || 0)]
              });
            })
          )
        }));
      });
    } catch (error: any) {
      console.error('❌ Error obteniendo variantes:', error);
      this.errorVariantes = 'No se pudieron cargar las variantes. Cerrá y volvé a abrir el producto (no se puede guardar así).';
    } finally {
      this.cargandoVariantes = false;
    }
  }

  /** Mostrar el campo para pegar la URL de la foto a mano */
  mostrarUrlFoto = false;
  readonly nombreColor = nombreColor;

  // ---------- Ayudas de la pantalla ----------

  /** Margen sobre el costo (%), o null si no se puede calcular */
  margen(campoPrecio: string): number | null {
    const costo = Number(this.formProducto?.get('precioCosto')?.value) || 0;
    const precio = Number(this.formProducto?.get(campoPrecio)?.value) || 0;
    if (costo <= 0 || precio <= 0) return null;
    return Math.round(((precio - costo) / costo) * 100);
  }

  get totalStockPrincipal(): number {
    const sucursales = (this.stockArray?.getRawValue() || []).reduce((a: number, s: any) => a + (Number(s.cantidad) || 0), 0);
    return sucursales + (Number(this.formProducto?.get('stockMayorista')?.value) || 0);
  }

  totalVariante(i: number): number {
    const v: any = this.variantesArray.at(i)?.getRawValue() || {};
    return (v.stockSucursales || []).reduce((a: number, s: any) => a + (Number(s.cantidad) || 0), 0)
      + (Number(v.stockMayorista) || 0);
  }

  /** La variante es el mismo documento que se está editando */
  esVarianteActual(i: number): boolean {
    return !!this.variantesArray.at(i)?.get('id')?.value && this.variantesArray.at(i).get('id')?.value === this.producto.id;
  }

  get imagenActual(): string {
    return this.fotosProducto[0] || '';
  }

  /** El editor de fotos avisa cada cambio: la primera foto es la "imagen" principal */
  alCambiarFotos(fotos: string[]): void {
    this.fotosProducto = [...(fotos || [])];
    this.formProducto?.get('imagen')?.setValue(this.fotosProducto[0] || '');
  }

  /** No se puede guardar mientras falte cargar algo */
  get puedeGuardar(): boolean {
    return !!this.formProducto && !this.cargandoVariantes && !this.errorVariantes && !this.subiendoImagen;
  }

private crearFormulario(): void {
  this.fotosProducto = fotosDe(this.producto as any);
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

  async eliminarVariante(index: number): Promise<void> {
    const grupo = this.variantesArray.at(index);
    const id: string | null = grupo?.get('id')?.value || null;

    if (id && id === this.producto.id) {
      await Swal.fire('No se puede quitar',
        'Es la variante que estás editando. Para eliminarla usá el botón eliminar de la lista de productos.', 'info');
      return;
    }

    if (id) {
      const color = grupo.get('color')?.value;
      const modelo = grupo.get('modelo')?.value;
      const r = await Swal.fire({
        title: '¿Eliminar esta variante?',
        html: `${modelo ? `Modelo <strong>${modelo}</strong> · ` : ''}color <span style="display:inline-block;width:14px;height:14px;border-radius:50%;vertical-align:-2px;border:1px solid #999;background:${color}"></span>` +
          '<br><small>Se elimina al tocar <strong>Guardar</strong>. Queda guardada en "Productos eliminados" por si hay que recuperarla.</small>',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Eliminar variante',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#d33'
      });
      if (!r.isConfirmed) return;
      this.variantesEliminadas.push(id);
    }

    // La quitamos del formulario (una variante nueva sin guardar simplemente desaparece)
    this.variantesArray.removeAt(index);
  }


  guardar(): void {

    // Nunca guardar con las variantes sin cargar ni con la foto subiendo
    if (!this.puedeGuardar) return;

    if (this.formProducto.invalid) {
      this.formProducto.markAllAsTouched();
      return;
    }

    const valores = this.formProducto.getRawValue();
    const fotos = [...this.fotosProducto];
    const principal = fotos[0] || '';
    const principalAnterior = this.producto.imagen || '';
    const productoActualizado: Producto = {
      ...this.producto,
      ...valores,
      imagen: principal,
      imagenes: fotos,
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
        // Si la variante usaba la foto principal de siempre, pasa a usar la nueva
        imagen: (!v.imagen || v.imagen === principalAnterior) ? (principal || null) : v.imagen,

        stockMayorista: Number(v.stockMayorista) || 0,

        stockSucursales: (v.stockSucursales || []).map((s: any) => ({
          sucursalId: s.sucursalId,
          cantidad: Number(s.cantidad) || 0
        }))
      }))
    };

    

    // Solo estas variantes se eliminan (las demás que existan en Firestore se mantienen)
    (productoActualizado as any).variantesEliminadas = [...this.variantesEliminadas];

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
    const input = event.target as HTMLInputElement;
    const file: File | undefined = input?.files?.[0];
    if (!file) return;

    this.subiendoImagen = true;
    try {
      const nombreArchivo = `productos/${Date.now()}_${file.name}`;
      const storageRef = ref(this.storage, nombreArchivo);

      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);

      this.formProducto.get('imagen')?.setValue(url);

    } catch (error: any) {
      console.error('Error subiendo imagen', error);
      Swal.fire('No se pudo subir la foto', error?.code === 'storage/unauthorized'
        ? 'No tenés permiso para subir imágenes de productos.'
        : 'Probá de nuevo. ' + (error?.message || ''), 'error');
    } finally {
      this.subiendoImagen = false;
      if (input) input.value = '';
    }
  }


}
