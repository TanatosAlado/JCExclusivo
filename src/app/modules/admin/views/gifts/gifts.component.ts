import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { VouchersPuntosService } from 'src/app/shared/services/vouchers-puntos.service';

@Component({
  selector: 'app-gifts',
  templateUrl: './gifts.component.html',
  styleUrls: ['./gifts.component.css']
})
export class GiftsComponent { formPuntos!: FormGroup;

  constructor(private fb: FormBuilder, private puntosService: VouchersPuntosService) {}

  async ngOnInit() {
    this.formPuntos = this.fb.group({
      valorParaSumarPunto: [0, [Validators.required, Validators.min(1)]],
      valorMonetarioPorPunto: [0, [Validators.required, Validators.min(1)]]
    });

    const valores = await this.puntosService.obtenerValoresPuntos();
    this.formPuntos.patchValue(valores);
  }

  async guardar() {
    if (this.formPuntos.valid) {
      await this.puntosService.actualizarValoresPuntos(this.formPuntos.value);
      alert('Valores actualizados correctamente');
    }
  }
}