import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CarritoComponent } from './components/carrito/carrito.component';
import { LayoutShopComponent } from './components/layout-shop/layout-shop.component';
import { DestacadosComponent } from './views/destacados/destacados.component';
import { ItemComponent } from './views/item/item.component';
import { GrillaItemComponent } from './views/grilla-item/grilla-item.component';
import { SharedModule } from 'src/app/shared/shared.module';
import { BannerComponent } from './views/banner/banner.component';
import { DetalleProductoComponent } from './views/detalle-producto/detalle-producto.component';
import { CheckoutComponent } from './views/checkout/checkout.component';
import { ItemEquipoComponent } from './views/item-equipo/item-equipo.component';
import { GaleriaFotosComponent } from './components/galeria-fotos/galeria-fotos.component';
import { MiCuentaComponent } from './views/mi-cuenta/mi-cuenta.component';



@NgModule({
  declarations: [
    CarritoComponent,
    LayoutShopComponent,
    DestacadosComponent,
    ItemComponent,
    GrillaItemComponent,
    BannerComponent,
    DetalleProductoComponent,
    CheckoutComponent,
    ItemEquipoComponent,
    GaleriaFotosComponent,
    MiCuentaComponent
  ],
  imports: [
    CommonModule,
    SharedModule
  ]
})
export class ShopModule { }
