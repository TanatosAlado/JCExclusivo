import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SharedModule } from 'src/app/shared/shared.module';
import { LoginComponent } from './views/login/login.component';
import { RegistroComponent } from './views/registro/registro.component';



@NgModule({
  declarations: [
    LoginComponent,
    RegistroComponent
  ],
  imports: [
    CommonModule,
    SharedModule
  ]
})
export class AuthModule { }
