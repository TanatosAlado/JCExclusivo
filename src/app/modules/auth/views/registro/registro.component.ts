import { Component } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Auth, createUserWithEmailAndPassword } from '@angular/fire/auth';
import { Firestore, collection, doc, setDoc, query, where, getDocs } from '@angular/fire/firestore';
import { Router } from '@angular/router';
import { Cliente } from '../../models/cliente.model';
import { MatDialogRef } from '@angular/material/dialog';
import { AuthService } from '../../services/auth.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AnalyticsService } from 'src/app/shared/services/analytics.service';
import { errorDatosSolicitud, limpiarCuit, nuevaSolicitud } from 'src/app/shared/utils/solicitud-mayorista';

@Component({
  selector: 'app-registro',
  templateUrl: './registro.component.html',
  styleUrls: ['./registro.component.css']
})
export class RegistroComponent {
  formRegistroCliente: FormGroup;
  error: string | null = null;

  constructor(
    private analytics: AnalyticsService,
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
        cuit?.setValidators([Validators.required, Validators.pattern(/^\d{2}-?\d{8}-?\d$/)]);
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
    const form = {
      ...this.formRegistroCliente.value,
      usuario: this.formRegistroCliente.value.usuario
        ?.trim()
        .toUpperCase(),

      dni: Number(this.formRegistroCliente.value.dni)  
    };

    // Mayorista: se valida el CUIT (con su dígito verificador) antes de crear nada
    const pideMayorista = form.esMayorista === true;
    if (pideMayorista) {
      const errorSolicitud = errorDatosSolicitud(form);
      if (errorSolicitud) {
        this.error = errorSolicitud;
        return;
      }
    }

    // 1. Validar que el nombre de usuario no exista (índice 'Usuarios', sin leer Clientes)
    if (!form.usuario || form.usuario.includes('/')) {
      this.error = 'El nombre de usuario no es válido.';
      return;
    }

    if (await this.authService.existeUsuario(form.usuario)) {
      this.error = 'El nombre de usuario ya está registrado.';
      return;
    }

    try {
      // 2. Crear en Firebase Auth
      const cred = await createUserWithEmailAndPassword(this.auth, form.mail, form.contrasena);
      const uid = cred.user.uid;

      // 3. Crear nuevo cliente (modelo actualizado)
      const nuevoCliente = new Cliente(

        false,             // administrador
        form.apellido,
        [],                // carrito
        pideMayorista ? limpiarCuit(form.cuit) : '',
        form.direccion,
        form.dni,
        false,             // esMayorista: siempre minorista hasta que un administrador apruebe la solicitud
        true,
        [],                // historial
        uid,
        form.mail,
        form.nombre,
        0,                 // puntos
        pideMayorista ? String(form.razonSocial || '').trim() : '',
        form.telefono,
        form.usuario,
      );

      // 4. Guardar en Firestore (si pidió ser mayorista, la solicitud queda pendiente)
      const datosCliente: any = { ...nuevoCliente };
      if (pideMayorista) datosCliente.solicitudMayorista = nuevaSolicitud(form);
      await setDoc(doc(this.firestore, 'Clientes', uid), datosCliente);

      // 4.b Índice de usuario → mail (para poder iniciar sesión con el nombre de usuario)
      await this.authService.registrarEnIndice(form.usuario, uid, cred.user.email || form.mail);

      // 5. Login automático
      const clienteLogueado = await this.authService.login(form.usuario, form.contrasena);

      if (clienteLogueado) {
        this.authService.setUsuarioActual(clienteLogueado);
        this.analytics.registro();
        const mensaje = pideMayorista
          ? `¡Bienvenido/a, ${form.nombre}! Tu solicitud de cuenta mayorista quedó en revisión: ` +
            'te avisamos cuando esté aprobada. Mientras tanto ves los precios minoristas.'
          : 'Registro exitoso. Bienvenido/a, ' + form.nombre + '!';
        // Así no se le vuelve a mostrar el mismo aviso al iniciar sesión
        if (pideMayorista) {
          try { localStorage.setItem(`avisoMayorista:${uid}:pendiente:${datosCliente.solicitudMayorista.fecha}`, '1'); } catch { }
        }
        this.snackBar.open(mensaje, 'Cerrar', {
          duration: pideMayorista ? 9000 : 4000,
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