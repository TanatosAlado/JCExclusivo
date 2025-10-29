import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ValidatorFn, AbstractControl, ValidationErrors, FormArray } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { SucursalesService } from 'src/app/modules/admin/services/sucursales.service';
import { Producto } from 'src/app/modules/shop/models/producto.model';
import { ProductosService } from 'src/app/modules/shop/services/productos.service';

@Component({
  selector: 'app-alta-producto',
  templateUrl: './alta-producto.component.html',
  styleUrls: ['./alta-producto.component.css']
})
export class AltaProductoComponent {

  productoForm!: FormGroup;
  sucursales: any[] = [];

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: { rubros: string[], subrubros: string[], marcas: string[] },
    private fb: FormBuilder,
    private productosService: ProductosService,
    private dialogRef: MatDialogRef<AltaProductoComponent>,
    private sucursalesService: SucursalesService
  ) { }

  rubros: string[] = [];
  subrubros: string[] = [];
  marcas: string[] = [];
  rubrosFiltrados: string[] = [];
  subrubrosFiltrados: string[] = [];
  marcasFiltradas: string[] = [];

  ngOnInit(): void {

    if (this.data) {
      this.rubros = this.data.rubros || [];
      this.subrubros = this.data.subrubros || [];
      this.marcas = this.data.marcas || [];
    }

    this.obtenerSucursales();

    this.productoForm = this.fb.group({
      codigoBarras: ['', Validators.required],
      descripcion: ['', Validators.required],
      imagen: [''],
      color: ['#000000'],
      rubro: ['', Validators.required],
      subrubro: [''],
      marca: ['', Validators.required],

      precioCosto: [0, [Validators.required, Validators.min(0)]],
      precioSinImpuestos: [0, [Validators.required, Validators.min(0)]],

      ventaMinorista: [false],
      precioMinorista: [{ value: 0, disabled: true }],
      ventaMayorista: [false],
      precioMayorista: [{ value: 0, disabled: true }],

      oferta: [false],
      precioOferta: [{ value: 0, disabled: true }],
      destacado: [false],

      stockMinimo: [0, Validators.min(0)],

      stockSucursales: this.fb.array(
        this.sucursales.map(s => this.fb.group({
          sucursalId: [s.id],
          cantidad: [0, Validators.min(0)]
        }))
      ),
      stockMayorista: [0],
      variantes: this.fb.array([])

    }, { validators: [this.alMenosUnCanalVenta()] });

    this.setupAutocomplete();
    this.setupConditionalFields();
  }

  /** Reglas de habilitado/validadores según checkboxes */
  private setupConditionalFields(): void {
    const precioMinoristaCtrl = this.productoForm.get('precioMinorista');
    const precioMayoristaCtrl = this.productoForm.get('precioMayorista');
    const precioOfertaCtrl = this.productoForm.get('precioOferta');

    const ventaMinoristaCtrl = this.productoForm.get('ventaMinorista');
    const ventaMayoristaCtrl = this.productoForm.get('ventaMayorista');
    const ofertaCtrl = this.productoForm.get('oferta');

    // minorista
    const applyMinorista = (val: boolean) => {
      if (val) {
        precioMinoristaCtrl?.enable();
        precioMinoristaCtrl?.setValidators([Validators.required, Validators.min(0)]);
      } else {
        precioMinoristaCtrl?.reset(0);
        precioMinoristaCtrl?.disable();
        precioMinoristaCtrl?.clearValidators();
      }
      precioMinoristaCtrl?.updateValueAndValidity();
    };

    // mayorista
    const applyMayorista = (val: boolean) => {
      if (val) {
        precioMayoristaCtrl?.enable();
        precioMayoristaCtrl?.setValidators([Validators.required, Validators.min(0)]);
      } else {
        precioMayoristaCtrl?.reset(0);
        precioMayoristaCtrl?.disable();
        precioMayoristaCtrl?.clearValidators();
      }
      precioMayoristaCtrl?.updateValueAndValidity();
    };

    // oferta
    const applyOferta = (val: boolean) => {
      if (val) {
        precioOfertaCtrl?.enable();
        precioOfertaCtrl?.setValidators([Validators.required, Validators.min(0)]);
      } else {
        precioOfertaCtrl?.reset(0);
        precioOfertaCtrl?.disable();
        precioOfertaCtrl?.clearValidators();
      }
      precioOfertaCtrl?.updateValueAndValidity();
    };

    // init + subscriptions
    applyMinorista(!!ventaMinoristaCtrl?.value);
    applyMayorista(!!ventaMayoristaCtrl?.value);
    applyOferta(!!ofertaCtrl?.value);

    ventaMinoristaCtrl?.valueChanges.subscribe(applyMinorista);
    ventaMayoristaCtrl?.valueChanges.subscribe(applyMayorista);
    ofertaCtrl?.valueChanges.subscribe(applyOferta);
  }

  /** Autocomplete simple (comparación case-insensitive) */
  private setupAutocomplete(): void {
    this.productoForm.get('rubro')?.valueChanges.subscribe(valor => {
      const f = (valor || '').toString().toUpperCase();
      this.rubrosFiltrados = this.rubros.filter(r => r.toUpperCase().includes(f));
    });

    this.productoForm.get('subrubro')?.valueChanges.subscribe(valor => {
      const f = (valor || '').toString().toUpperCase();
      this.subrubrosFiltrados = this.subrubros.filter(s => s.toUpperCase().includes(f));
    });

    this.productoForm.get('marca')?.valueChanges.subscribe(valor => {
      const f = (valor || '').toString().toUpperCase();
      this.marcasFiltradas = this.marcas.filter(m => m.toUpperCase().includes(f));
    });
  }

  /** Al menos un canal de venta debe estar activo */
  private alMenosUnCanalVenta(): ValidatorFn {
    return (group: AbstractControl): ValidationErrors | null => {
      const vm = group.get('ventaMinorista')?.value;
      const vM = group.get('ventaMayorista')?.value;
      return vm || vM ? null : { sinCanalVenta: true };
    };
  }

  limpiarCerosIzquierda(campo: string): void {
    const control = this.productoForm.get(campo);
    if (!control) return;
    const valor: string = control.value?.toString() ?? '';
    const valorLimpio = valor.replace(/^0+(?!$)/, '');
    if (valor !== valorLimpio) control.setValue(valorLimpio);
  }

  permitirSoloNumeros(event: KeyboardEvent): void {
    const char = event.key;
    if (!/^\d$/.test(char)) event.preventDefault();
  }

private sanitizeProductoPayload(v: any) {
  const rubro = (v?.rubro ?? '').toString().toUpperCase();
  const subrubro = (v?.subrubro ?? '').toString().toUpperCase();
  const marca = (v?.marca ?? '').toString().toUpperCase();
  const color = v?.color ? v.color.toString() : '#000000';

  const stockSucursales = Array.isArray(v?.stockSucursales)
    ? v.stockSucursales.map((s: any) => ({
        sucursalId: s?.sucursalId ?? '',
        cantidad: Number.isFinite(Number(s?.cantidad)) ? Number(s.cantidad) : 0
      }))
    : [];

  const variantesRaw = Array.isArray(v?.variantes) ? v.variantes : [];
  const variantes = variantesRaw
    .map((varObj: any) => {
      const colorVar = (varObj?.color ?? '').toString();
      const codigoBarras = (varObj?.codigoBarras ?? '').toString();
      const stockVar = Array.isArray(varObj?.stockSucursales)
        ? varObj.stockSucursales.map((s: any) => ({
            sucursalId: s?.sucursalId ?? '',
            cantidad: Number.isFinite(Number(s?.cantidad)) ? Number(s.cantidad) : 0
          }))
        : [];
      const stockMayorista = Number.isFinite(Number(varObj?.stockMayorista)) ? Number(varObj.stockMayorista) : 0;

      const isEmpty = !colorVar && !codigoBarras && stockVar.every(s => s.cantidad === 0) && stockMayorista === 0;
      if (isEmpty) return null;

      return {
        color: colorVar,
        ...(codigoBarras ? { codigoBarras } : {}),
        stockSucursales: stockVar,
        stockMayorista
      };
    })
    .filter(x => x !== null);

  return {
    codigoBarras: (v?.codigoBarras ?? '').toString(),
    descripcion: (v?.descripcion ?? '').toString(),
    imagen: (v?.imagen ?? '').toString(),
    color,
    rubro,
    subrubro,
    marca,
    precioCosto: Number.isFinite(Number(v?.precioCosto)) ? Number(v.precioCosto) : 0,
    precioSinImpuestos: Number.isFinite(Number(v?.precioSinImpuestos)) ? Number(v.precioSinImpuestos) : 0,
    ventaMinorista: !!v?.ventaMinorista,
    precioMinorista: Number.isFinite(Number(v?.precioMinorista)) ? Number(v?.precioMinorista) : 0,
    ventaMayorista: !!v?.ventaMayorista,
    precioMayorista: Number.isFinite(Number(v?.precioMayorista)) ? Number(v?.precioMayorista) : 0,
    oferta: !!v?.oferta,
    precioOferta: Number.isFinite(Number(v?.precioOferta)) ? Number(v?.precioOferta) : 0,
    destacado: !!v?.destacado,
    stockMinimo: Number.isFinite(Number(v?.stockMinimo)) ? Number(v?.stockMinimo) : 0,
    stockSucursales,
    stockMayorista: Number.isFinite(Number(v?.stockMayorista)) ? Number(v?.stockMayorista) : 0,
    variantes // ✅ siempre array, aunque esté vacío
  };
}




onSubmit() {
  if (this.productoForm.invalid) {
    this.productoForm.markAllAsTouched();
    return;
  }

  // getRawValue para incluir controles deshabilitados (precios)
  const raw = this.productoForm.getRawValue();

  // sanitizo y normalizo
  const payload = this.sanitizeProductoPayload(raw);
  if (!payload.color) {
    payload.color = '#000000';
  }

  // construyo el Producto respetando el orden del constructor
const producto = new Producto(
  '',
  payload.codigoBarras,
  payload.descripcion,
  payload.precioCosto,

  // 🛒 Minorista
  payload.ventaMinorista,
  payload.precioMinorista,

  // 🏷️ Mayorista
  payload.ventaMayorista,
  payload.precioMayorista,

  // 📸 Imagen
  payload.imagen,

  // 🧩 Clasificación
  payload.rubro,
  payload.subrubro,
  payload.marca,

  // ⭐ Promociones
  payload.destacado,
  payload.oferta,
  payload.precioOferta ?? 0,
  payload.precioSinImpuestos,

  // 📦 Stock
  payload.stockMinimo,
  payload.stockSucursales,
  payload.stockMayorista ?? 0,

  // 🎨 Opcionales
  payload.color,
  payload.variantes
);


  console.log('Nuevo producto (sanitizado):', producto);

  this.productosService.agregarProducto(producto)
    .then((docRef) => {
      producto.id = docRef.id;
      return this.productosService.actualizarProducto(producto);
    })
    .then(() => {
      this.dialogRef.close(producto);
    })
    .catch(err => {
      console.error('Error al guardar producto:', err);
      // opcional: mostrar mensaje al usuario
    });
}


obtenerSucursales(): void {
  this.sucursalesService.obtenerSucursales().subscribe(sucs => {
    this.sucursales = sucs;

    const stockArray = this.productoForm.get('stockSucursales') as any;
    stockArray.clear(); // limpia lo que tenga

    sucs.forEach(s => {
      stockArray.push(this.fb.group({
        sucursalId: [s.id],
        cantidad: [0, [Validators.min(0)]]
      }));
    });
  });
}

get variantes(): FormArray {
  return this.productoForm.get('variantes') as FormArray;
}

nuevaVariante(): FormGroup {
  return this.fb.group({
    color: [''],
    codigoBarras: [''],
    stockSucursales: this.fb.array(
      this.sucursales.map(s => this.fb.group({
        sucursalId: [s.id],
        cantidad: [0, [Validators.min(0)]]
      }))
    ),
    stockMayorista: [0, [Validators.min(0)]]
  });
}

agregarVariante() {
  this.variantes.push(this.nuevaVariante());
}

eliminarVariante(index: number) {
  this.variantes.removeAt(index);
}


}
