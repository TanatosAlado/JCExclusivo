import { Component } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatDialogRef } from '@angular/material/dialog';
import { Marquesina } from 'src/app/modules/admin/models/marquesina.model';
import { MarquesinaService } from 'src/app/modules/admin/services/marquesina.service';

@Component({
  selector: 'app-alta-marquesina',
  templateUrl: './alta-marquesina.component.html',
  styleUrls: ['./alta-marquesina.component.css']
})
export class AltaMarquesinaComponent {

  formAltaMarquesina: FormGroup;

  constructor(private marquesinaService: MarquesinaService, private fb: FormBuilder, private dialogRef: MatDialogRef<AltaMarquesinaComponent>) {
    {
      this.formAltaMarquesina = this.fb.group({
        mensaje: ['', Validators.required],
        tipoCliente: ['', Validators.required],
      });
    }
  }

  cancelar() {
    this.dialogRef.close(false);
  }

  async guardar() {

    try {
      const data = this.formAltaMarquesina.value;
      const marquesina: Marquesina = {
        id: '',
        mensaje: data.mensaje,
        tipoCliente: data.tipoCliente
      };
      const docRef =
      await this.marquesinaService.agregarMarquesina(
        marquesina
      );

    // ASIGNAR ID
     marquesina.id = docRef.id;
    }
    catch (error) {
    }
  }
}

