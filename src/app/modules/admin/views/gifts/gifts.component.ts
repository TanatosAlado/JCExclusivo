import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { VouchersPuntosService } from 'src/app/shared/services/vouchers-puntos.service';
import { Cupon } from '../../models/cupones.model';
import { Observable } from 'rxjs';
import { addDoc, collection, deleteDoc, doc, Firestore } from '@angular/fire/firestore';

@Component({
  selector: 'app-gifts',
  templateUrl: './gifts.component.html',
  styleUrls: ['./gifts.component.css']
})
export class GiftsComponent implements OnInit {
  formPuntos!: FormGroup;
  cuponForm!: FormGroup;
  cupones: Cupon[] = [];


  constructor(private fb: FormBuilder, private puntosService: VouchersPuntosService, private firestore: Firestore) {}

  ngOnInit(): void {
    this.initForms();
    this.cargarDatos();
  }

  private initForms(): void {
    this.formPuntos = this.fb.group({
      valorParaSumarPunto: [null, Validators.required],
      valorMonetarioPorPunto: [null, Validators.required],
    });

    this.cuponForm = this.fb.group({
      codigo: ['', Validators.required],
      tipo: ['monto', Validators.required],
      valor: [null, [Validators.required, Validators.min(1)]],
      cantidadDisponible: [null, [Validators.required, Validators.min(1)]],
      activo: [true],
    });
  }

  private cargarDatos(): void {
    // Cargar valores de puntos
    this.puntosService.obtenerValoresPuntos().then((valores) => {
      if (valores) {
        this.formPuntos.patchValue(valores);
        console.log('Valores de puntos cargados:', valores);
      }
    });

    // Suscribirse a los cupones
    this.puntosService.obtenerCupones().subscribe((cupones) => {
      this.cupones = cupones;
    });
  }

    crearCupon(): void {
    const cupon = this.cuponForm.value as Cupon;
    const cuponesRef = collection(this.firestore, 'Cupones');
    addDoc(cuponesRef, cupon).then(() => {
      this.cuponForm.reset({
        tipo: 'monto',
        activo: true,
        cantidadDisponible: 1,
        valor: 0
      });
    });
  }

  guardarPuntos(): void {
    if (this.formPuntos.valid) {
      this.puntosService.actualizarValoresPuntos(this.formPuntos.value);
    }
  }

  guardarCupon(): void {
    if (this.cuponForm.valid) {
      const cupon: Cupon = this.cuponForm.value;
      this.puntosService.crearCupon(cupon).then(() => {
        this.cuponForm.reset({
          codigo: '',
          tipo: 'monto',
          valor: 0,
          cantidadDisponible: 1,
          activo: true,
        });
      });
    }
  }

    guardar(): void {
    if (this.formPuntos.valid) {
      this.puntosService.guardarValoresPuntos(this.formPuntos.value)
        .then(() => console.log('Valores guardados'))
        .catch((error) => console.error('Error al guardar puntos', error));
    }
  }

  eliminarCupon(cupon: Cupon): void {
    if (!cupon.id) return;
    const cuponDocRef = doc(this.firestore, 'Cupones', cupon.id);
    deleteDoc(cuponDocRef);
  }
}