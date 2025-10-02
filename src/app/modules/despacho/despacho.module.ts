import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LayoutDespachoComponent } from './components/layout-despacho/layout-despacho.component';
import { SharedModule } from 'src/app/shared/shared.module';
import { AbrirCajaDialogComponent } from './components/abrir-caja-dialog/abrir-caja-dialog.component';



@NgModule({
  declarations: [
    LayoutDespachoComponent,
    AbrirCajaDialogComponent
  ],
  imports: [
    CommonModule,
    SharedModule 
  ]
})
export class DespachoModule { }
