import { Component } from '@angular/core';
import { doc, updateDoc, setDoc, Firestore } from '@angular/fire/firestore';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { InfoEmpresa } from 'src/app/shared/models/infoEmpresa.model'; 
import { InfoEmpresaService } from 'src/app/shared/services/info-empresa.service';

@Component({
  selector: 'app-empresa',
  templateUrl: './empresa.component.html',
  styleUrls: ['./empresa.component.css']
})
export class EmpresaComponent {

  infoForm: FormGroup;
  cargando: boolean = true;

  constructor(
    private fb: FormBuilder,
    private infoService: InfoEmpresaService,
    private firestore: Firestore,
    private snackBar: MatSnackBar
  ) {
    this.infoForm = this.fb.group({
      whatsapp: ['', [Validators.required]],
      cvu: ['', [Validators.required]],
      alias: ['', [Validators.required]],
      email: ['', [Validators.required, Validators.email]]
    });
  }

  ngOnInit(): void {
    this.infoService.obtenerInfoGeneral().subscribe((data) => {
      if (data) {
        this.infoForm.patchValue(data);
      }
      this.cargando = false;
    });
  }

  async guardar() {
    if (this.infoForm.invalid) return;

    const data: InfoEmpresa = this.infoForm.value;
    const docRef = doc(this.firestore, 'InfoEmpresa/general');

    try {
      await setDoc(docRef, data, { merge: true });
      this.snackBar.open('Información actualizada con éxito', 'Cerrar', { duration: 3000 });
    } catch (error) {
      console.error('Error al guardar', error);
      this.snackBar.open('Error al guardar la información', 'Cerrar', { duration: 3000 });
    }
  }
}
