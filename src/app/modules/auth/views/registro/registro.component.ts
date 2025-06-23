import { Component } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Auth, createUserWithEmailAndPassword } from '@angular/fire/auth';
import { Firestore, collection, doc, setDoc, query, where, getDocs } from '@angular/fire/firestore';
import { Router } from '@angular/router';
import { Cliente } from '../../models/cliente.model'; 
import { MatDialogRef } from '@angular/material/dialog';

@Component({
  selector: 'app-registro',
  templateUrl: './registro.component.html',
  styleUrls: ['./registro.component.css']
})
export class RegistroComponent {
  formRegistroCliente: FormGroup;
  error: string | null = null;

  constructor(
    private fb: FormBuilder,
    private auth: Auth,
    private firestore: Firestore,
    private router: Router,
    private dialogRef: MatDialogRef<RegistroComponent>,
  ) {
    this.formRegistroCliente = this.fb.group({
      usuario: ['', [Validators.required, Validators.minLength(6), Validators.pattern('^[a-zA-Z0-9]+$')]],
      nombre: ['', [Validators.required, Validators.pattern('^[a-zA-ZñÑáéíóúÁÉÍÓÚ\\s]+$')]],
      apellido: ['', [Validators.required, Validators.pattern('^[a-zA-ZñÑáéíóúÁÉÍÓÚ\\s]+$')]],
      contrasena: ['', [Validators.required, Validators.minLength(6)]],
      dni: ['', [Validators.required, Validators.pattern('^[0-9]{7,8}$')]],
      mail: ['', [Validators.required, Validators.email]],
      telefono: ['', [Validators.required, Validators.pattern('^[0-9]+$')]],
      direccion: ['', Validators.required]
    });
  }

  async crearCliente() {
    this.error = null;

    const form = this.formRegistroCliente.value;

    // Validar que el nombre de usuario no exista
    const clientesRef = collection(this.firestore, 'Clientes');
    const q = query(clientesRef, where('usuario', '==', form.usuario));
    const existing = await getDocs(q);

    if (!existing.empty) {
      this.error = 'El nombre de usuario ya está registrado.';
      return;
    }

    try {
      const cred = await createUserWithEmailAndPassword(this.auth, form.mail, form.contrasena);
      const uid = cred.user.uid;

      const nuevoCliente = new Cliente(
        uid,
        form.usuario,
        '',
        form.mail,
        form.telefono,
        form.direccion,
        [],
        true,
        form.nombre,
        form.apellido,
        false,
        [],
        form.dni,
        0,
      );

      await setDoc(doc(this.firestore, 'Clientes', uid), { ...nuevoCliente });
    this.dialogRef.close(nuevoCliente);
     // this.router.navigate(['/login']);
    } catch (err: any) {
      this.error = err.message;
    }
  }

  cerrar() {
    this.router.navigate(['/']);
  }
}