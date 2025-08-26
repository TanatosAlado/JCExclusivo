import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ValidatorFn, AbstractControl, ValidationErrors } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Producto } from 'src/app/modules/shop/models/producto.model';
import { ProductosService } from 'src/app/modules/shop/services/productos.service';

@Component({
  selector: 'app-alta-producto',
  templateUrl: './alta-producto.component.html',
  styleUrls: ['./alta-producto.component.css']
})
export class AltaProductoComponent {

  productoForm!: FormGroup;

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: { rubros: string[], subrubros: string[], marcas: string[] },
    private fb: FormBuilder,
    private productosService: ProductosService,
    private dialogRef: MatDialogRef<AltaProductoComponent>
  ) {}

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

this.productoForm = this.fb.group({
  // básicos
  codigoBarras: ['', [Validators.required]],
  descripcion: ['', Validators.required],
  imagen: [''],
  rubro: ['', Validators.required],
  subrubro: ['', Validators.required],
  marca: ['', Validators.required],

  // precios
  precioCosto: [0, [Validators.required, Validators.min(0)]],
  precioSinImpuestos: [0, [Validators.required, Validators.min(0)]], // 👈 nuevo campo obligatorio

  ventaMinorista: [false],
  precioMinorista: [{ value: 0, disabled: true }, [Validators.min(0)]],

  ventaMayorista: [false],
  precioMayorista: [{ value: 0, disabled: true }, [Validators.min(0)]],

  oferta: [false],
  precioOferta: [{ value: 0, disabled: true }, [Validators.min(0)]],

  destacado: [false],

  // stock
  stock: [0, [Validators.min(0)]],
  stockMinimo: [0, [Validators.min(0)]],
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

  onSubmit() {
    if (this.productoForm.invalid) {
      this.productoForm.markAllAsTouched();
      return;
    }

    // getRawValue para incluir controles deshabilitados (precios)
    const v = this.productoForm.getRawValue();

    // normalizo textos a MAYÚSCULAS donde corresponde
    const rubro = (v.rubro || '').toString().toUpperCase();
    const subrubro = (v.subrubro || '').toString().toUpperCase();
    const marca = (v.marca || '').toString().toUpperCase();

    // armamos el objeto según el modelo nuevo
    const producto: Producto = {
      id: '', // lo seteo luego con el docRef.id
      codigoBarras: v.codigoBarras,
      descripcion: v.descripcion,
      precioCosto: Number(v.precioCosto) || 0,
      precioSinImpuestos: Number(v.precioSinImpuestos) || 0,

      ventaMinorista: !!v.ventaMinorista,
      precioMinorista: Number(v.precioMinorista) || 0,

      ventaMayorista: !!v.ventaMayorista,
      precioMayorista: Number(v.precioMayorista) || 0,

      imagen: v.imagen || '',
      rubro,
      subrubro,
      marca,
      destacado: !!v.destacado,

      oferta: !!v.oferta,
      precioOferta: Number(v.precioOferta) || 0,

      stock: Number(v.stock) || 0,
      stockMinimo: Number(v.stockMinimo) || 0,
    };

    this.productosService.agregarProducto(producto)
      .then((docRef) => {
        producto.id = docRef.id;
        return this.productosService.actualizarProducto(producto);
      })
      .then(() => {
        this.dialogRef.close(producto);
      });
  }


}
