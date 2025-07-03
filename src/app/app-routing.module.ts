import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { ClientesComponent } from './modules/admin/views/clientes/clientes/clientes.component';
import { DashboardComponent } from './shared/components/dashboard/dashboard.component';
import { ProductosComponent } from './modules/admin/views/productos/productos.component';
import { AdminLayoutComponent } from './modules/admin/components/admin-layout/admin-layout/admin-layout.component';
import { GestionesComponent } from './modules/admin/views/gestiones/gestiones/gestiones.component';
import { LayoutShopComponent } from './modules/shop/components/layout-shop/layout-shop.component';
import { GrillaItemComponent } from './modules/shop/views/grilla-item/grilla-item.component';
import { DetalleProductoComponent } from './modules/shop/views/detalle-producto/detalle-producto.component';

const routes: Routes = [
    { path: '', redirectTo: 'inicio', pathMatch: 'prefix' },
  { path: 'inicio', component: LayoutShopComponent,
    //canActivate: [AuthGuard],
  },
  {
    path: 'gestiones',
    component: AdminLayoutComponent,
    // canActivate: [AdminGuard],
    children: [
      { path: '', component: GestionesComponent }, 
      { path: 'clientes', component: ClientesComponent },
      { path: 'productos', component: ProductosComponent },
    ]
  },
  {path:'productos',component: GrillaItemComponent},
  {path:'producto/:id',component:DetalleProductoComponent}
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
