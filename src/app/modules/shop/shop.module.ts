import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CarritoComponent } from './components/carrito/carrito.component';
import { LayoutShopComponent } from './components/layout-shop/layout-shop.component';
import { DestacadosComponent } from './views/destacados/destacados.component';
import { ItemComponent } from './views/item/item.component';
import { GrillaItemComponent } from './views/grilla-item/grilla-item.component';



@NgModule({
  declarations: [
    CarritoComponent,
    LayoutShopComponent,
    DestacadosComponent,
    ItemComponent,
    GrillaItemComponent
  ],
  imports: [
    CommonModule
  ]
})
export class ShopModule { }
