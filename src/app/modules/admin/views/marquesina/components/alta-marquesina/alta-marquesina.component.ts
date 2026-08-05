import { Component } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatDialogRef } from '@angular/material/dialog';

@Component({
  selector: 'app-alta-marquesina',
  templateUrl: './alta-marquesina.component.html',
  styleUrls: ['./alta-marquesina.component.css']
})
export class AltaMarquesinaComponent {

   formAltaMarquesina: FormGroup;

  constructor(private fb: FormBuilder, private dialogRef: MatDialogRef<AltaMarquesinaComponent>) { 
     {
        this.formAltaMarquesina = this.fb.group({
          descripcion:['', Validators.required],
          tipoCliente: ['', Validators.required],
        });
      }
  }

 cancelar() {
    this.dialogRef.close(false);
  }

guardar() {
}
}
