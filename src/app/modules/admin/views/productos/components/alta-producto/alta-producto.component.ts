import { Component, Inject, OnInit } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import { FormBuilder, FormGroup, Validators, ValidatorFn, AbstractControl, ValidationErrors, FormArray, FormControl } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { addDoc, collection, updateDoc } from 'firebase/firestore';
import { Sucursal } from 'src/app/modules/admin/models/sucursal.model';
import { SucursalesService } from 'src/app/modules/admin/services/sucursales.service';
import { Producto, VarianteProducto } from 'src/app/modules/shop/models/producto.model';
import { ProductosService } from 'src/app/modules/shop/services/productos.service';
import { v4 as uuidv4 } from 'uuid';
import { Storage, ref, uploadBytes, getDownloadURL } from '@angular/fire/storage';


@Component({
  selector: 'app-alta-producto',
  templateUrl: './alta-producto.component.html',
  styleUrls: ['./alta-producto.component.css']
})
export class AltaProductoComponent implements OnInit {

  // Form principal
  form: FormGroup;
  guardando = false;

  modos = [
    { value: 'none', label: 'Producto único' },
    { value: 'color', label: 'Con variantes por color' },
    { value: 'modelo+color', label: 'Con variantes por modelo y color' }
  ];

  tipoSeleccionado: 'none' | 'color' | 'modelo' | 'modelo+color' | null = null;

  sucursales: Sucursal[] = [];

  producto: Producto = new Producto(
    '', // id
    '', // codigoBarras
    '', // descripcion
    '', // subdescripcion
    0,  // precioCosto
    false, // ventaMinorista
    0, // precioMinorista
    false, // ventaMayorista
    0, // precioMayorista
    'ARS', // moneda
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

  imagenSeleccionada: File | null = null;
  imagenPreview: string | null = null;
  subiendoImagen = false;

  constructor(private fb: FormBuilder, private sucursalService: SucursalesService, private firestore: Firestore, private dialogRef: MatDialogRef<AltaProductoComponent>, private storage: Storage) { }

  ngOnInit(): void {
    // 1) Primero creamos el form (siempre primero)
    this.form = this.fb.group({
      modo: ['none', Validators.required],

      // campos generales
      descripcion: ['', Validators.required],
      subdescripcion: [''],
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
      moneda: ['ARS', Validators.required], 
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


  /**
   * Devuelve un FormGroup listo para usarse como variante.
   * Inicializa color con un hex válido por defecto y el stock por sucursal.
   */
  nuevaVariante(): FormGroup {
    return this.fb.group({
      modelo: [''],
      color: ['#ffffff'], // inicializamos color en hex válido por defecto
      precioMinorista: [0, [Validators.min(0)]],
      precioMayorista: [0, [Validators.min(0)]],
      moneda: ['ARS'],
      stockSucursales: this.crearStockSucursalesArray(),
      imagen: [''],
      codigoBarras: [''],
      stockMayorista: [0]
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

  seleccionarTipo(tipo: 'none' | 'color' | 'modelo' | 'modelo+color') {
    this.tipoSeleccionado = tipo;
    this.producto.tipoVariantes = tipo;
  }

  guardarProductoUnico() {
    this.producto.id = uuidv4(); // genera un id único
    
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
        formValue.subdescripcion,
        formValue.precioCosto,
        formValue.ventaMinorista,
        formValue.precioMinorista,
        formValue.ventaMayorista,
        formValue.precioMayorista,
        formValue.moneda,
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
            color: this.sanitizeColor(color.color),
            codigoBarras: color.codigoBarras,
            stockMayorista: color.stockMayorista,
            stockSucursales: color.stockSucursales
          });
        });
      });

      producto.variantes = variantes;

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
      color: ['#ffffff'],
      codigoBarras: [''],
      precioMinorista: [0],
      precioMayorista: [0],
      moneda: ['ARS'],
      stockSucursales: this.crearStockSucursalesArray(),
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


async guardarProducto() {

  let urlImagen: string | null = null;

  if (this.imagenSeleccionada) {
    urlImagen = await this.subirImagenProducto();

    if (urlImagen) {
      // producto único
      if (this.tipoSeleccionado === 'none') {
        this.producto.imagen = urlImagen;
      }

      // variantes
      if (this.form && (this.tipoSeleccionado === 'color' || this.tipoSeleccionado === 'modelo+color')) {
        this.form.get('imagen')?.setValue(urlImagen);
      }
    }
  }

  const formValue = this.form ? this.form.value : {};
  try {
    // -------- PRODUCTO ÚNICO --------
    if (this.tipoSeleccionado === 'none') {
      const payloadUnico = {
        nombre: this.producto.descripcion || '',
        descripcion: this.producto.descripcion || '',
        subdescripcion: this.producto.subdescripcion || '',
        codigoBarras: this.producto.codigoBarras || '',
        precioCosto: Number(this.producto.precioCosto || 0),
        precioSinImpuestos: Number(this.producto.precioSinImpuestos || 0),
        precioMinorista: Number(this.producto.precioMinorista || 0),
        precioMayorista: Number(this.producto.precioMayorista || 0),
        moneda: this.producto.moneda || 'ARS',
        oferta: Boolean(this.producto.oferta),
        precioOferta: this.producto.oferta ? Number(this.producto.precioOferta || 0) : null,
        destacado: Boolean(this.producto.destacado),
        imagen: this.producto.imagen || '',
        rubro: this.producto.rubro || '',
        subrubro: this.producto.subrubro || '',
        marca: this.producto.marca || '',
        stockMayorista: Number(this.producto.stockMayorista || 0),
        stockSucursales: this.mapStockSucursales(this.producto.stockSucursales),
        stockMinimo: Number(this.producto.stockMinimo || 0),
        tipoVariantes: 'none',
        fechaAlta: new Date()
      };

      const productosRef = collection(this.firestore, 'productos');
      console.log('Guardando producto único con payload:', payloadUnico);
      const docRef = await addDoc(productosRef, payloadUnico);

      // 🔥 IMPORTANTE: asignar ID interno
      await updateDoc(docRef, { id: docRef.id });

      this.dialogRef.close(true);
      return;
    }

    // -------- PRODUCTO CON VARIANTES POR COLOR --------
    if (this.tipoSeleccionado === 'color') {
      const idPadre = uuidv4();
      const base = formValue;
      const productosRef = collection(this.firestore, 'productos');

      const variantesArr = formValue.variantes || [];
      for (const v of variantesArr) {
        const colorHex = this.sanitizeColor(v.color);
        const doc = {
          productoPadre: idPadre,
          nombre: `${base.descripcion} - ${colorHex}`.trim(),
          descripcion: base.descripcion || '',
          codigoBarras: v.codigoBarras || '',
          precioCosto: Number(base.precioCosto || 0),
          precioSinImpuestos: Number(base.precioSinImpuestos || 0),
          precioMinorista: Number(v.precioMinorista ?? base.precioMinorista ?? 0),
          precioMayorista: Number(v.precioMayorista ?? base.precioMayorista ?? 0),
          moneda: base.moneda || 'ARS',
          oferta: Boolean(base.oferta),
          precioOferta: base.oferta ? Number(base.precioOferta || 0) : null,
          destacado: Boolean(base.destacado),
          imagen: base.imagen || '',
          rubro: base.rubro || '',
          subrubro: base.subrubro || '',
          marca: base.marca || '',
          color: colorHex,
          stockMayorista: Number(v.stockMayorista || 0),
          stockSucursales: this.mapStockSucursales(v.stockSucursales),
          tipoVariantes: 'color',
          fechaAlta: new Date()
        };

        const docRef = await addDoc(productosRef, doc);

        // 🔥 guardar ID dentro del documento
        await updateDoc(docRef, { id: docRef.id });
      }

      this.dialogRef.close(true);
      return;
    }

    // -------- PRODUCTO CON MODELO --------
    if (this.tipoSeleccionado === 'modelo') {
      const idPadre = uuidv4();
      const base = formValue;
      const productosRef = collection(this.firestore, 'productos');

      for (const v of formValue.variantes) {
        const doc = {
          productoPadre: idPadre,
          nombre: `${base.descripcion} - ${v.modelo}`.trim(),
          descripcion: base.descripcion || '',
          modelo: v.modelo,
          codigoBarras: v.codigoBarras || '',
          precioCosto: Number(base.precioCosto || 0),
          precioSinImpuestos: Number(base.precioSinImpuestos || 0),
          precioMinorista: Number(base.precioMinorista || 0),
          precioMayorista: Number(base.precioMayorista || 0),
          moneda: base.moneda || 'ARS',
          oferta: Boolean(base.oferta),
          precioOferta: base.oferta ? Number(base.precioOferta || 0) : null,
          destacado: Boolean(base.destacado),
          imagen: base.imagen || '',
          rubro: base.rubro || '',
          subrubro: base.subrubro || '',
          marca: base.marca || '',
          stockMayorista: Number(v.stockMayorista || 0),
          stockSucursales: this.mapStockSucursales(v.stockSucursales),
          tipoVariantes: 'modelo',
          fechaAlta: new Date()
        };

        const docRef = await addDoc(productosRef, doc);
        await updateDoc(docRef, { id: docRef.id });
      }

      this.dialogRef.close(true);
      return;
    }

    // -------- PRODUCTO CON MODELO + COLOR --------
    if (this.tipoSeleccionado === 'modelo+color') {
      const idPadre = uuidv4();
      const base = formValue;
      const productosRef = collection(this.firestore, 'productos');

      const modelos = (formValue.variantes || []);
      for (const modelo of modelos) {
        const modeloNombre = modelo.modelo || '';
        const colores = (modelo.colores || []);

        for (const color of colores) {
          const colorHex = this.sanitizeColor(color.color);
          const doc = {
            productoPadre: idPadre,
            nombre: `${base.descripcion} - ${modeloNombre} - ${colorHex}`.trim(),
            descripcion: base.descripcion || '',
            modelo: modeloNombre,
            color: colorHex,
            codigoBarras: color.codigoBarras || '',
            precioCosto: Number(base.precioCosto || 0),
            precioSinImpuestos: Number(base.precioSinImpuestos || 0),
            precioMinorista: Number(color.precioMinorista ?? base.precioMinorista ?? 0),
            precioMayorista: Number(color.precioMayorista ?? base.precioMayorista ?? 0),
            moneda: base.moneda || 'ARS',
            oferta: Boolean(base.oferta),
            precioOferta: base.oferta ? Number(base.precioOferta || 0) : null,
            destacado: Boolean(base.destacado),
            imagen: base.imagen || '',
            rubro: base.rubro || '',
            subrubro: base.subrubro || '',
            marca: base.marca || '',
            stockMayorista: Number(color.stockMayorista || 0),
            stockSucursales: this.mapStockSucursales(color.stockSucursales),
            tipoVariantes: 'modelo+color',
            fechaAlta: new Date()
          };

          const docRef = await addDoc(productosRef, doc);

          // 🔥 guardar ID interno
          await updateDoc(docRef, { id: docRef.id });
        }
      }

      this.dialogRef.close(true);
      return;
    }

    console.warn('Tipo seleccionado desconocido:', this.tipoSeleccionado);

  } catch (err) {
    console.error('Error guardando producto:', err);
    alert('Error al guardar el producto. Revisa la consola.');
  }
}


  /**
   * Normaliza/valida un color. Si la entrada ya es un #rrggbb válido lo devuelve en minúscula.
   * Si no, devuelve '#ffffff' por defecto.
   */
  private sanitizeColor(value: any): string {
    if (!value || typeof value !== 'string') return '#ffffff';
    const v = value.trim();
    const hexRegex = /^#([0-9A-Fa-f]{6})$/;
    if (hexRegex.test(v)) return v.toLowerCase();
    // opcional: podríamos mapear nombres 'red' => '#ff0000' aquí si querés
    return '#ffffff';
  }

  private mapStockSucursales(stockArray: any[] | undefined): { [id: string]: number } {
    const out: { [id: string]: number } = {};
    if (!stockArray || !Array.isArray(stockArray)) return out;
    stockArray.forEach(s => {
      if (s && s.sucursalId) out[s.sucursalId] = Number(s.cantidad || 0);
    });
    return out;
  }


  agregarVarianteColor() {
    if (!this.sucursales || this.sucursales.length === 0) {
      console.warn('⚠️ No hay sucursales cargadas aún.');
      return;
    }

    const varianteGroup = this.fb.group({
      color: ['#ffffff'],
      codigoBarras: [''],
      stockSucursales: this.crearStockSucursalesArray(),
      stockMayorista: [0]
    });

    this.variantes.push(varianteGroup);
  }

  getNombreSucursal(id: string): string {
    const suc = this.sucursales?.find(s => s.id === id);
    return suc ? suc.nombre : 'Sucursal';
  }


  eliminarVarianteColor(index: number) {
    this.producto.variantes.splice(index, 1);
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
      color: ['#ffffff', Validators.required],
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

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;

    if (!input.files || input.files.length === 0) {
      return;
    }

    const file = input.files[0];
    this.imagenSeleccionada = file;

    // Preview
    const reader = new FileReader();
    reader.onload = () => {
      this.imagenPreview = reader.result as string;
    };
    reader.readAsDataURL(file);
  }


async subirImagenProducto(): Promise<string | null> {
  if (!this.imagenSeleccionada) return null;

  try {
    this.subiendoImagen = true;

    const nombreArchivo = `productos/${Date.now()}_${this.imagenSeleccionada.name}`;
    const imagenRef = ref(this.storage, nombreArchivo);

    await uploadBytes(imagenRef, this.imagenSeleccionada);
    return await getDownloadURL(imagenRef);

  } catch (error) {
    console.error('Error subiendo imagen', error);
    return null;
  } finally {
    this.subiendoImagen = false;
  }
}

  agregarModeloSimple(): void {
    const modeloGroup = this.fb.group({
      modelo: ['', Validators.required],
      codigoBarras: [''],
      stockMayorista: [0, [Validators.required, Validators.min(0)]],
      stockSucursales: this.crearStockSucursalesArray()
    });

    this.getVariantes().push(modeloGroup);
  }

  getStockSucursalesModelo(modelo: AbstractControl): FormArray {
    return modelo.get('stockSucursales') as FormArray;
  }

}
