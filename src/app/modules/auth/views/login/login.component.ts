import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { AuthService, LoginError } from '../../services/auth.service';
import { Router } from '@angular/router';
import { LoginRequest } from '../../models/loginRequest.model';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Cliente } from '../../models/cliente.model';
import { signOut } from '@angular/fire/auth';
import { AnalyticsService } from 'src/app/shared/services/analytics.service';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css']
})
export class LoginComponent {

  usuario: string = '';
  contrasena: string = '';
  loginFail: boolean = false
  /** Qué falló: usuario, contraseña, etc. */
  mensajeError = 'Datos de acceso incorrectos';
  public loginMayorista: boolean = false;
  emailRecuperacion: string = '';
  mostrarRecuperacion: boolean = false;
  /** Mientras ingresa, entra como invitado o envía el correo: se bloquea todo el login (sin dobles clics) */
  ocupado: 'ingresar' | 'invitado' | 'recuperar' | null = null;

  constructor(private analytics: AnalyticsService,
              private authService: AuthService, 
              private dialogRef: MatDialogRef<LoginComponent>, 
              private dialog: MatDialog,
              private router: Router,
              private snackBar: MatSnackBar,
              @Inject(MAT_DIALOG_DATA) public data: { esMayorista: boolean }
            ) { }

  ngOnInit() {
    this.loginMayorista = this.data?.esMayorista ?? false;
  }          

  /** Bloquea el login (y que se cierre el cuadro) mientras hay algo en curso */
  private bloquear(que: 'ingresar' | 'invitado' | 'recuperar') {
    this.ocupado = que;
    this.dialogRef.disableClose = true;
  }

  private desbloquear() {
    this.ocupado = null;
    this.dialogRef.disableClose = false;
  }

  abrirRegistro() {
    if (this.ocupado) return;
    this.cerrar()
    this.authService.openRegistroModal();
   }

   
  async login() {
    if (this.ocupado || !this.usuario.trim() || !this.contrasena) return;
    this.bloquear('ingresar');
    try {
      // El usuario no distingue mayúsculas (el servicio prueba todas las variantes)
      const loginRequest = new LoginRequest(
        this.usuario.trim(),
        this.contrasena
      );

      const cliente = await this.authService.login(loginRequest.user, loginRequest.password);

      if (cliente) {
        this.loginFail = false;
        // Redirigir al dashboard o página principal
        //this.router.navigate(['/home']); // Cambia según tu ruta
        this.authService.setUsuarioActual(cliente);
        this.analytics.login('cuenta');   // los administradores no se miden (lo filtra el servicio)
        this.snackBar.open('Login exitoso. ¡Bienvenido!', 'Cerrar', {
          duration: 3000,
          panelClass: ['snackbar-success'],
      });
      this.dialogRef.close(cliente);  
      } else {
        this.loginFail = true;
        this.mensajeError = 'No encontramos los datos de esa cuenta.';
      }
    } catch (error) {
      this.loginFail = true;
      this.mensajeError = error instanceof LoginError ? error.message : 'Datos de acceso incorrectos';
      console.error('Error en login:', error);
    } finally {
      this.desbloquear();
    }
  }

  cerrar() {
    if (this.ocupado) return;
    this.dialogRef.close();
  }

  alternarRecuperacion() {
    if (this.ocupado) return;
    this.mostrarRecuperacion = !this.mostrarRecuperacion;
  }

  resetLoginFail(): void {
    this.loginFail = false;
  }

  async continuarComoInvitado(): Promise<void> {
    if (this.ocupado) return;
    this.bloquear('invitado');
    try {
      await signOut(this.authService['auth']);
    } catch (e) {
      console.error('Error al salir de la cuenta anterior', e);
    } finally {
      this.desbloquear();
    }
    const clienteInvitado = new Cliente(
      false,             // administrador
      '',                // apellido
      [],                // carrito
      '',                 // cuit
      '',                // direccion
      null,                // dni
      false,             // esMayorista
      true,              // estado
      [],                // historial
      'invitado',        // id
      '',                // mail
      'Invitado',        // nombre
      0,                 // puntos
      '',                // razonSocial
      '',                // telefono
      'invitado',        // usuario

    );

    this.authService.setUsuarioActual(clienteInvitado);
    this.analytics.login('invitado');
    this.dialogRef.close(clienteInvitado);
  }


  async recuperarContrasena(): Promise<void> {
    if (this.ocupado) return;

    if (!this.emailRecuperacion || this.emailRecuperacion.trim() === '') {

      this.snackBar.open('Ingrese un correo válido', 'Cerrar', {
        duration: 3000,
        panelClass: ['snackbar-error']
      });

      return;
    }

    this.bloquear('recuperar');
    try {

      await this.authService.recuperarPassword(this.emailRecuperacion);

      this.snackBar.open(
        'Te enviamos un correo para restablecer tu contraseña',
        'Cerrar',
        {
          duration: 5000,
          panelClass: ['snackbar-success']
        }
      );

    } catch (error: any) {

      console.error(error);

      let mensaje = 'Ocurrió un error';

      switch (error.code) {

        case 'auth/user-not-found':
          mensaje = 'No existe una cuenta con ese correo';
          break;

        case 'auth/invalid-email':
          mensaje = 'Correo inválido';
          break;

        default:
          mensaje = 'No se pudo enviar el correo de recuperación';
          break;
      }

      this.snackBar.open(mensaje, 'Cerrar', {
        duration: 4000,
        panelClass: ['snackbar-error']
      });
    } finally {
      this.desbloquear();
    }
  }


}
