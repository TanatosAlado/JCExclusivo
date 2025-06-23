import { Component } from '@angular/core';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { AuthService } from '../../services/auth.service';
import { Router } from '@angular/router';
import { LoginRequest } from '../../models/loginRequest.model';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css']
})
export class LoginComponent {

  usuario: string = '';
  contrasena: string = '';
  loginFail: boolean = false

  constructor(private authService: AuthService, 
              private dialogRef: MatDialogRef<LoginComponent>, 
              private dialog: MatDialog,
              private router: Router) { }

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

}
