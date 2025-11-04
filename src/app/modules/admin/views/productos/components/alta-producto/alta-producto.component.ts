import { Component, Inject, OnInit } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import {
  FormBuilder,
  FormGroup,
  Validators,
  ValidatorFn,
  AbstractControl,
  ValidationErrors,
  FormArray,
  FormControl
} from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { addDoc, collection } from 'firebase/firestore';
import { Sucursal } from 'src/app/modules/admin/models/sucursal.model';
import { SucursalesService } from 'src/app/modules/admin/services/sucursales.service';
import { Producto, VarianteProducto } from 'src/app/modules/shop/models/producto.model';
import { ProductosService } from 'src/app/modules/shop/services/productos.service';
import { v4 as uuidv4 } from 'uuid';

@Component({
  selector: 'app-alta-producto',
  templateUrl: './alta-producto.component.html',
  styleUrls: ['./alta-producto.component.css']
})
export class AltaProductoComponent implements OnInit {

  // Form principal
  form: FormGroup;
  guardando = false;

  // modos: 'none' = producto único, 'color' = variante por color, 'modelo+color' = variante por modelo+color
  modos = [
    { value: 'none', label: 'Producto único' },
    { value: 'color', label: 'Con variantes por color' },
    { value: 'modelo+color', label: 'Con variantes por modelo y color' }
  ];

  tipoSeleccionado: 'none' | 'color' | 'modelo+color' | null = null;
  sucursales: Sucursal[] = [];

  producto: Producto = new Producto(
    '', // id
    '', // codigoBarras
    '', // descripcion
    0,  // precioCosto
    false, // ventaMinorista
    0, // precioMinorista
    false, // ventaMayorista
    0, // precioMayorista
    '', // imagen
    '', // rubro
    '', // subrubro
    '', // marca
    false, // destacado
    false, // oferta
    0, // precioOferta
    0, // precioSinImpuestos
    0, // stockMinimo
    [], // stockSucursales
    0,  // stockMayorista
    [], // variantes
    'none' // tipoVariantes
  );

  constructor(private fb: FormBuilder, private sucursalService: SucursalesService) { }

  ngOnInit(): void {
    // 1) Primero creamos el form (siempre primero)
    this.form = this.fb.group({
      modo: ['none', Validators.required],

      // campos generales
      descripcion: ['', Validators.required],
      rubro: ['', Validators.required],
      subrubro: [''],
      marca: [''],
      imagen: [''], // URL

      // precios
      precioCosto: [0, [Validators.required, Validators.min(0)]],
      precioSinImpuestos: [0],
      ventaMinorista: [true],
      precioMinorista: [0],
      ventaMayorista: [false],
      precioMayorista: [0],
      oferta: [false],
      precioOferta: [0],
      destacado: [false],

      // stock general (cuando producto único)
      stockSucursales: this.fb.array([]),
      stockMayorista: [0],
      stockMinimo: [0],

      // variantes (aseguramos que exista desde el inicio)
      variantes: this.fb.array([]),

      // codigoBarras: ['']
    });

    // 2) Cargamos sucursales (esto inicializa también el stock por sucursal)
    this.cargarSucursales();

    // 🔹 Agregamos inicialización inmediata de stockSucursales (para producto único)
    if (this.sucursales && this.sucursales.length > 0) {
      const stockArray = this.form.get('stockSucursales') as FormArray;
      this.sucursales.forEach(suc =>
        stockArray.push(
          this.fb.group({
            sucursalId: [suc.id],
            cantidad: [0, [Validators.required, Validators.min(0)]],
          })
        )
      );
    }

    // 3) Inicializamos el FormArray variantes de forma segura (ya existe, pero reforzamos)
    if (!this.form.get('variantes')) {
      this.form.addControl('variantes', this.fb.array([]));
    } else {
      // si existe, dejamos como está (vacío)
      this.form.setControl('variantes', this.fb.array([]));
    }

    // 4) Validación condicional precioMinorista
    this.form.get('ventaMinorista')!.valueChanges.subscribe(v => {
      const pc = this.form.get('precioMinorista');
      if (v) {
        pc!.setValidators([Validators.required, Validators.min(0.01)]);
      } else {
        pc!.clearValidators();
      }
      pc!.updateValueAndValidity({ onlySelf: true });
    });

    // 5) Reaccionar al cambio de modo (solo una suscripción)
    this.form.get('modo')!.valueChanges.subscribe(modo => {
      this.tipoSeleccionado = modo;
      if (modo === 'none') {
        this.actualizarStockSucursalesBase();
        // limpiar variantes
        this.setVariantesArray([]);
      } else if (modo === 'color') {
        // dejamos el arreglo vacío y permitimos agregar variantes
        this.setVariantesArray([]);
        // opcional: si querés copiar el stock base a cada variante al crearlas, se haría ahí
        this.actualizarStockSucursalesBase();
      } else {
        // modelo+color
        this.setVariantesArray([]);
        this.actualizarStockSucursalesBase();
      }
    });
  }


  // ---------- Sucursales ----------
  cargarSucursales() {
    this.sucursalService.obtenerSucursales().subscribe({
      next: (sucs) => {
        this.sucursales = sucs || [];

        this.producto.stockSucursales = this.sucursales.map(s => ({
          sucursalId: s.id,
          cantidad: 0
        }));

        this.actualizarStockSucursalesBase();
      },
      error: (err) => {
        console.error('Error cargando sucursales', err);
        this.sucursales = [];
        this.actualizarStockSucursalesBase();
      }
    });
  }

  seleccionarTipo(tipo: 'none' | 'color' | 'modelo+color') {
    this.tipoSeleccionado = tipo;
    this.producto.tipoVariantes = tipo;
  }

  guardarProductoUnico() {
    this.producto.id = uuidv4(); // genera un id único
    console.log('✅ Producto a guardar:', this.producto);
    // luego acá harás el save a Firestore
  }

  actualizarStockSucursalesBase() {
    const arr = this.fb.array(
      this.sucursales.map(s => this.fb.group({ sucursalId: [s.id], cantidad: [0] }))
    );
    this.form.setControl('stockSucursales', arr);
  }


  // ---------- variantes (placeholder para adelante) ----------
  get variantes(): FormArray {
    const control = this.form.get('variantes');
    if (control instanceof FormArray) return control;
    // si por alguna razón no existe, creamos y devolvemos uno vacío
    const arr = this.fb.array([]);
    this.form.setControl('variantes', arr);
    return arr;
  }


  setVariantesArray(items: any[]) {
    const arr = this.fb.array(items || []);
    // si this.form no existe (defensivo), creamos el form mínimo (no debería pasar si usaste el ngOnInit corregido)
    if (!this.form) {
      this.form = this.fb.group({ variantes: arr });
      return;
    }
    this.form.setControl('variantes', arr);
  }

  guardarProductoColor() {
    if (this.form.invalid) {
      console.log('Formulario inválido:', this.form.value);
      this.form.markAllAsTouched();
      return;
    }

    this.guardando = true;
    try {
      // Construir el producto final
      const formValue = this.form.value;

      const producto: Producto = new Producto(
        uuidv4(),                     // id
        //    formValue.codigoBarras,       // codigoBarras (producto base)
        '',
        formValue.descripcion,
        formValue.precioCosto,
        formValue.ventaMinorista,
        formValue.precioMinorista,
        formValue.ventaMayorista,
        formValue.precioMayorista,
        formValue.imagen,             // imagen única
        formValue.rubro,
        formValue.subrubro,
        formValue.marca,
        formValue.destacado,
        formValue.oferta,
        formValue.precioOferta,
        formValue.precioSinImpuestos,
        formValue.stockMinimo,
        formValue.stockSucursales,
        formValue.stockMayorista,
        formValue.variantes.map((v: any) => ({
          color: v.color,
          codigoBarras: v.codigoBarras,
          stockSucursales: v.stockSucursales,
          stockMayorista: v.stockMayorista
        })),
        'color' // tipoVariantes
      );

      console.log('✅ Producto con variantes por color listo para guardar:', producto);

      // TODO: enviar a Firestore
    } finally {
      this.guardando = false;
    }
  }

  guardarProductoModeloColor() {
  if (this.form.invalid) {
    this.form.markAllAsTouched();
    console.warn('❌ Formulario inválido:', this.form.value);
    return;
  }

  this.guardando = true;
  try {
    const formValue = this.form.value;

    const producto: Producto = new Producto(
      uuidv4(),
      '', // código general no aplica
      formValue.descripcion,
      formValue.precioCosto,
      formValue.ventaMinorista,
      formValue.precioMinorista,
      formValue.ventaMayorista,
      formValue.precioMayorista,
      formValue.imagen,
      formValue.rubro,
      formValue.subrubro,
      formValue.marca,
      formValue.destacado,
      formValue.oferta,
      formValue.precioOferta,
      formValue.precioSinImpuestos,
      formValue.stockMinimo,
      formValue.stockSucursales,
      formValue.stockMayorista,
      [], // variantes (se generan abajo)
      'modelo+color'
    );

    // 🔹 Armamos las variantes (modelos + colores)
    const variantes: VarianteProducto[] = [];
    formValue.variantes.forEach((modelo: any) => {
      modelo.colores.forEach((color: any) => {
        variantes.push({
          modelo: modelo.modelo,
          color: color.color,
          codigoBarras: color.codigoBarras,
          stockMayorista: color.stockMayorista,
          stockSucursales: color.stockSucursales
        });
      });
    });

    producto.variantes = variantes;

    console.log('✅ Producto con variantes por modelo+color listo para guardar:', producto);

    // 🔸 TODO: guardar en Firestore cuando quieras integrarlo
  } catch (err) {
    console.error('Error preparando producto modelo+color:', err);
  } finally {
    this.guardando = false;
  }
}




  agregarVarianteEjemplo() {
    // util: crear una variante con stock por sucursal
    const g = this.fb.group({
      modelo: [''],
      color: [''],
      codigoBarras: [''],
      precioMinorista: [0],
      precioMayorista: [0],
      stockSucursales: this.fb.array(this.sucursales.map(s => this.fb.group({ sucursalId: [s.id], cantidad: [0] }))),
      stockMayorista: [0]
    });
    this.variantes.push(g);
  }


  // ---------- utilidades de UI y cálculo ----------
  get stockTotal(): number {
    const arr = this.form.get('stockSucursales') as FormArray;
    if (!arr || arr.length === 0) return 0;
    return arr.controls.reduce((acc, cur) => acc + (cur.get('cantidad')!.value || 0), 0);
  }


  get stockGlobal(): number {
    return this.stockTotal + (this.form.get('stockMayorista')!.value || 0);
  }

  // ---------- guardar (stub) ----------
  async guardarProducto() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }


    this.guardando = true;
    try {
      // por ahora solo mostramos el payload en consola
      const payload = this.form.value;
      console.log('Producto listo para guardar:', payload);
      // TODO: en el siguiente paso integramos con Firestore


      // reset limpio manteniendo modo en 'none'
      const modo = this.form.get('modo')!.value;
      this.form.reset({ modo });
      this.actualizarStockSucursalesBase();
      this.variantes.clear();


    } catch (err) {
      console.error(err);
      alert('Error al preparar el guardado');
    } finally {
      this.guardando = false;
    }
  }

  agregarVarianteColor() {
    if (!this.sucursales || this.sucursales.length === 0) {
      console.warn('⚠️ No hay sucursales cargadas aún.');
      return;
    }

    const varianteGroup = this.fb.group({
      color: [''],
      codigoBarras: [''],
      stockSucursales: this.fb.array(
        this.sucursales.map(s =>
          this.fb.group({
            sucursalId: [s.id],
            cantidad: [0]
          })
        )
      ),
      stockMayorista: [0]
    });

    this.variantes.push(varianteGroup);
    console.log('✅ Variante agregada. Total:', this.variantes.length);
  }

  getNombreSucursal(id: string): string {
    const suc = this.sucursales?.find(s => s.id === id);
    return suc ? suc.nombre : 'Sucursal';
  }


  eliminarVarianteColor(index: number) {
    this.producto.variantes.splice(index, 1);
    console.log('❌ Variante eliminada. Total:', this.producto.variantes.length);
  }


  // Devuelve el formArray de variantes (modelos)
  getVariantes(): FormArray {
    return this.form.get('variantes') as FormArray;
  }

  // Devuelve el formArray de colores de un modelo
  getColores(modeloIndex: number): FormArray {
    return this.getVariantes().at(modeloIndex).get('colores') as FormArray;
  }

  // Devuelve el formArray de stockSucursales de un color
  getStockSucursales(modeloIndex: number, colorIndex: number): FormArray {
    return this.getColores(modeloIndex).at(colorIndex).get('stockSucursales') as FormArray;
  }

  // Crea un grupo de stock por sucursal (reutilizando tus sucursales cargadas)
  crearStockSucursalesArray(): FormArray {
    return this.fb.array(this.sucursales.map(s => this.fb.group({
      sucursalId: [s.id],
      cantidad: [0, [Validators.required, Validators.min(0)]]
    })));
  }

  // Agrega un nuevo modelo
agregarModelo(): void {
  const modeloGroup = this.fb.group({
    modelo: ['', Validators.required],
    colores: this.fb.array([]),
  });
  this.getVariantes().push(modeloGroup);
}

  // Elimina un modelo
  eliminarModelo(index: number): void {
    this.getVariantes().removeAt(index);
  }

  // Agrega un color a un modelo
agregarColor(modeloIndex: number): void {
  const modelo = this.getVariantes().at(modeloIndex);
  const coloresArray = modelo.get('colores') as FormArray;

  const colorGroup = this.fb.group({
    color: ['', Validators.required],
    codigoBarras: [''],
    stockMayorista: [0, [Validators.required, Validators.min(0)]],
    stockSucursales: this.crearStockSucursalesArray()
  });

  coloresArray.push(colorGroup);
}

  // Elimina un color de un modelo
  eliminarColor(modeloIndex: number, colorIndex: number): void {
    this.getColores(modeloIndex).removeAt(colorIndex);
  }



}