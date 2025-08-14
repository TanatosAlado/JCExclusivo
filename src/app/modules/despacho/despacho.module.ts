import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LayoutDespachoComponent } from './components/layout-despacho/layout-despacho.component';
import { SharedModule } from 'src/app/shared/shared.module';



@NgModule({
  declarations: [
    LayoutDespachoComponent
  ],
  imports: [
    CommonModule,
    SharedModule 
  ]
})
export class DespachoModule { }
