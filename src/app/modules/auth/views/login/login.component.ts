import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { AuthService } from '../../services/auth.service';
import { Router } from '@angular/router';
import { LoginRequest } from '../../models/loginRequest.model';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Cliente } from '../../models/cliente.model';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css']
})
export class LoginComponent {

  usuario: string = '';
  contrasena: string = '';
  loginFail: boolean = false
  public loginMayorista: boolean = false;

  constructor(private authService: AuthService, 
              private dialogRef: MatDialogRef<LoginComponent>, 
              private dialog: MatDialog,
              private router: Router,
              private snackBar: MatSnackBar,
              @Inject(MAT_DIALOG_DATA) public data: { esMayorista: boolean }
            ) { }

  ngOnInit() {
    this.loginMayorista = this.data?.esMayorista ?? false;
  }          

  abrirRegistro() {
    this.cerrar()
    this.authService.openRegistroModal();
   }

   
  async onSubmit() {
    try {
      const loginRequest = new LoginRequest(this.usuario, this.contrasena);

      const cliente = await this.authService.login(loginRequest.user, loginRequest.password);

      if (cliente) {
        this.loginFail = false;
        // Redirigir al dashboard o página principal
        //this.router.navigate(['/home']); // Cambia según tu ruta
        this.authService.setUsuarioActual(cliente);
        this.snackBar.open('Login exitoso. ¡Bienvenido!', 'Cerrar', {
          duration: 3000,
          panelClass: ['snackbar-success'],
      });
      this.dialogRef.close(cliente);  
      } else {
        this.loginFail = true;
      }
    } catch (error) {
      this.loginFail = true;
      console.error('Error en login:', error);
    }
  }

  cerrar() {
    this.dialogRef.close();
  }

  resetLoginFail(): void {
    this.loginFail = false;
  }

  continuarComoInvitado(): void {
  const clienteInvitado = new Cliente(
    'invitado',        // id
    'invitado',        // usuario
    '',                // mail
    '',                // telefono
    '',                // direccion
    [],                // historial
    true,              // estado
    'Invitado',        // nombre
    '',                // apellido
    false,             // administrador
    [],                // carrito
    '',                // dni
    0,                 // puntos
    false,             // esMayorista
    '',                // razonSocial
    ''                 // cuit
  );

  this.authService.setUsuarioActual(clienteInvitado); 
  this.dialogRef.close(clienteInvitado);
}

}
