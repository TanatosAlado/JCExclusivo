import { Component } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Auth, createUserWithEmailAndPassword } from '@angular/fire/auth';
import { Firestore, collection, doc, setDoc, query, where, getDocs } from '@angular/fire/firestore';
import { Router } from '@angular/router';
import { Cliente } from '../../models/cliente.model';
import { MatDialogRef } from '@angular/material/dialog';
import { AuthService } from '../../services/auth.service';
import { MatSnackBar } from '@angular/material/snack-bar';

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
    private authService: AuthService,
    private snackBar: MatSnackBar
  ) {
    this.formRegistroCliente = this.fb.group({
      usuario: ['', [Validators.required, Validators.minLength(6), Validators.pattern('^[a-zA-Z0-9]+$')]],
      nombre: ['', [Validators.required, Validators.pattern('^[a-zA-ZñÑáéíóúÁÉÍÓÚ\\s]+$')]],
      apellido: ['', [Validators.required, Validators.pattern('^[a-zA-ZñÑáéíóúÁÉÍÓÚ\\s]+$')]],
      contrasena: ['', [Validators.required, Validators.minLength(6)]],
      dni: ['', [Validators.required, Validators.pattern('^[0-9]{7,8}$')]],
      mail: ['', [Validators.required, Validators.email]],
      telefono: ['', [Validators.required, Validators.pattern('^[0-9]+$')]],
      direccion: ['', Validators.required],
      esMayorista: [false],
      razonSocial: [''],
      cuit: ['']
    });

    this.formRegistroCliente.get('esMayorista')?.valueChanges.subscribe((esMayorista: boolean) => {
      const razonSocial = this.formRegistroCliente.get('razonSocial');
      const cuit = this.formRegistroCliente.get('cuit');

      if (esMayorista) {
        razonSocial?.setValidators([Validators.required]);
        cuit?.setValidators([Validators.required, Validators.pattern(/^\d{11}$/)]);
      } else {
        razonSocial?.clearValidators();
        cuit?.clearValidators();
      }

      razonSocial?.updateValueAndValidity();
      cuit?.updateValueAndValidity();
    });
  }

  async crearCliente() {
    this.error = null;
    const form = this.formRegistroCliente.value;

    // 1. Validar que el nombre de usuario no exista
    const clientesRef = collection(this.firestore, 'Clientes');
    const q = query(clientesRef, where('usuario', '==', form.usuario));
    const existing = await getDocs(q);

    if (!existing.empty) {
      this.error = 'El nombre de usuario ya está registrado.';
      return;
    }

    try {
      // 2. Crear en Firebase Auth
      const cred = await createUserWithEmailAndPassword(this.auth, form.mail, form.contrasena);
      const uid = cred.user.uid;

      // 3. Crear nuevo cliente (modelo actualizado)
      const nuevoCliente = new Cliente(
        uid,
        form.usuario,
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
        form.esMayorista,
        form.razonSocial || '',
        form.cuit || ''
      );

      // 4. Guardar en Firestore
      await setDoc(doc(this.firestore, 'Clientes', uid), { ...nuevoCliente });

      // 5. Login automático
      const clienteLogueado = await this.authService.login(form.usuario, form.contrasena);

      if (clienteLogueado) {
        this.authService.setUsuarioActual(clienteLogueado);
        this.snackBar.open('Registro exitoso. Bienvenido/a, ' + form.nombre + '!', 'Cerrar', {
          duration: 4000,
          horizontalPosition: 'center',
          verticalPosition: 'bottom',
          panelClass: ['snackbar-success']
        });
        this.dialogRef.close(clienteLogueado);
      } else {
        this.error = 'Registro correcto, pero hubo un error al iniciar sesión.';
      }

    } catch (err: any) {
      this.error = err.message;
    }
  }

  cerrar() {
    this.dialogRef.close();
  }
}