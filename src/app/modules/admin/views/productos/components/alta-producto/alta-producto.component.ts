import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators, FormArray, ValidatorFn, AbstractControl, ValidationErrors } from '@angular/forms';
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

  constructor(@Inject(MAT_DIALOG_DATA) public data: { rubros: string[], subrubros: string[], marcas: string[] },
    private fb: FormBuilder,
    private productosService: ProductosService,
    private dialogRef: MatDialogRef<AltaProductoComponent>) { }

  rubros: string[] = [];
  subrubros: string[] = [];
  marcas: string[] = [];
  rubrosFiltrados: string[] = [];
  subrubrosFiltrados: string[] = [];
  marcasFiltradas: string[] = []

ngOnInit(): void {

  if (this.data) {
    this.rubros = this.data.rubros || [];
    this.subrubros = this.data.subrubros || [];
    this.marcas = this.data.marcas || [];
  }

  this.productoForm = this.fb.group({
    nombre: ['', Validators.required],
    descripcion: [''],
    imagen: [''],
    rubro: ['', Validators.required],
    subrubro: ['', Validators.required],
    marca: ['', Validators.required],
    
    ventaMinorista: [false],
    precioMinorista: [0],
    
    ventaMayorista: [false],
    precioMayorista: [0],
    
    oferta: [false],
    precioOferta: [0],

    destacado: [false],

    stock: [0],
    tieneVariantes: [false],
    variantes: this.fb.array([]),
  });

  this.setupAutocomplete();
  this.setupConditionalFields();

  // Lógica para habilitar/deshabilitar stock
  this.productoForm.get('tieneVariantes')?.valueChanges.subscribe((tieneVariante) => {
    const stockCtrl = this.productoForm.get('stock');
    if (tieneVariante) {
      stockCtrl?.disable();
    } else {
      stockCtrl?.enable();
    }
  });

  // Si oferta = false, limpiamos precioOferta
  this.productoForm.get('oferta')?.valueChanges.subscribe(oferta => {
    const precioOfertaCtrl = this.productoForm.get('precioOferta');
    if (!oferta) {
      precioOfertaCtrl?.setValue(0);
      precioOfertaCtrl?.disable();
    } else {
      precioOfertaCtrl?.enable();
    }
  });

  // Similar para precioMinorista y precioMayorista
  this.productoForm.get('ventaMinorista')?.valueChanges.subscribe(minorista => {
    const ctrl = this.productoForm.get('precioMinorista');
    if (!minorista) {
      ctrl?.setValue(0);
      ctrl?.disable();
    } else {
      ctrl?.enable();
    }
  });

  this.productoForm.get('ventaMayorista')?.valueChanges.subscribe(mayorista => {
    const ctrl = this.productoForm.get('precioMayorista');
    if (!mayorista) {
      ctrl?.setValue(0);
      ctrl?.disable();
    } else {
      ctrl?.enable();
    }
  });
}

  setupConditionalFields(): void {
    this.productoForm.get('oferta')?.valueChanges.subscribe((oferta) => {
      const precioOferta = this.productoForm.get('precioOferta');
      if (oferta) {
        precioOferta?.enable();
        precioOferta?.setValidators([Validators.required, Validators.min(0)]);
      } else {
        precioOferta?.disable();
        precioOferta?.clearValidators();
        precioOferta?.setValue(0);
      }
      precioOferta?.updateValueAndValidity();
    });

  }

    setupAutocomplete(): void {
  this.productoForm.get('rubro')?.valueChanges.subscribe(valor => {
    const filtro = (valor || '').toUpperCase();
    this.rubrosFiltrados = this.rubros.filter(r => r.includes(filtro));
  });

  this.productoForm.get('subrubro')?.valueChanges.subscribe(valor => {
    const filtro = (valor || '').toUpperCase();
    this.subrubrosFiltrados = this.subrubros.filter(s => s.includes(filtro));
  });

  this.productoForm.get('marca')?.valueChanges.subscribe(valor => {
    const filtro = (valor || '').toUpperCase();
    this.marcasFiltradas = this.marcas.filter(s => s.includes(filtro));
  });
}

get variantes(): FormArray {
  return this.productoForm.get('variantes') as FormArray;
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

  guardarProducto() {
    if (this.productoForm.valid) {
      console.log(this.productoForm.value);
      // Aquí podés mandar los datos al backend
    }
  }

  limpiarCerosIzquierda(campo: string): void {
  const control = this.productoForm.get(campo);
  if (!control) return;

  let valor: string = control.value?.toString() ?? '';

  // Limpiamos todos los ceros a la izquierda, excepto si el valor es "0"
  const valorLimpio = valor.replace(/^0+(?!$)/, '');

  // Solo actualizamos si el valor cambia
  if (valor !== valorLimpio) {
    control.setValue(valorLimpio);
  }
}

soloNumerosValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const valor = control.value;
    return isNaN(valor) || valor === '' ? { soloNumeros: true } : null;
  };
}

permitirSoloNumeros(event: KeyboardEvent): void {
  const charCode = event.key;

  if (!/^\d$/.test(charCode)) {
    event.preventDefault();
  }
}

  onSubmit() {
    if (this.productoForm.valid) {
      const producto: Producto = this.productoForm.value;

      producto.rubro = producto.rubro.toUpperCase();
      producto.subrubro = producto.subrubro.toUpperCase();
      producto.marca = producto.marca.toUpperCase();

      this.productosService.agregarProducto(producto).then((docRef) => {
        producto.id = docRef.id; 
        return this.productosService.actualizarProducto(producto);    
    }).then(() => {
      this.dialogRef.close(producto); // cerramos el modal y devolvemos el producto actualizado
    });
    } else {
      this.productoForm.markAllAsTouched();
    }
  }

}
