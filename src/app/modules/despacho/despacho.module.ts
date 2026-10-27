import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LayoutDespachoComponent } from './components/layout-despacho/layout-despacho.component';
import { SharedModule } from 'src/app/shared/shared.module';
import { AbrirCajaDialogComponent } from './components/abrir-caja-dialog/abrir-caja-dialog.component';
import { AdminModule } from '../admin/admin.module';



@NgModule({
  declarations: [
    LayoutDespachoComponent,
    AbrirCajaDialogComponent
  ],
  imports: [
    CommonModule,
    SharedModule,
    AdminModule // buscador de tickets (TicketsComponent) dentro de despacho
  ]
})
export class DespachoModule { }
