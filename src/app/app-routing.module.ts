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
import { CheckoutComponent } from './modules/shop/views/checkout/checkout.component';
import { MiCuentaComponent } from './modules/shop/views/mi-cuenta/mi-cuenta.component';
import { AnalyticsTiendaComponent } from './modules/admin/views/analytics-tienda/analytics-tienda.component';
import { SolicitudesMayoristasComponent } from './modules/admin/views/solicitudes-mayoristas/solicitudes-mayoristas.component';
import { CuentaTallerComponent } from './modules/admin/views/cuenta-taller/cuenta-taller.component';
import { PedidosComponent } from './modules/admin/views/pedidos/pedidos.component';
import { EmpresaComponent } from './modules/admin/views/empresa/empresa.component';
import { GiftsComponent } from './modules/admin/views/gifts/gifts.component';
import { TallerComponent } from './modules/admin/views/taller/taller.component';
import { BannerComponent } from './modules/admin/views/banner/banner.component';
import { LayoutDespachoComponent } from './modules/despacho/components/layout-despacho/layout-despacho.component';
import { ConsultaOrdenComponent } from './shared/components/consulta-orden/consulta-orden.component';
import { CajaComponent } from './modules/admin/views/caja/caja.component';
import { SucursalesComponent } from './modules/admin/views/sucursales/sucursales.component';
import { MarquesinaComponent } from './modules/admin/views/marquesina/marquesina.component';
import { AdminGuard } from './core/admin.guard';
import { SuperAdminGuard } from './core/superadmin.guard';
import { PermisoGuard } from './core/permiso.guard';
import { PermisosUsuariosComponent } from './modules/admin/views/permisos-usuarios/permisos-usuarios.component';
import { AuditoriaComponent } from './modules/admin/views/auditoria/auditoria.component';
import { TableroComponent } from './modules/admin/views/tablero/tablero.component';
import { CajerosComponent } from './modules/admin/views/cajeros/cajeros.component';
import { CuentasCorrientesComponent } from './modules/admin/views/cuentas-corrientes/cuentas-corrientes.component';
import { CreditosComponent } from './modules/admin/views/creditos/creditos.component';
import { EquiposComponent } from './modules/admin/views/equipos/equipos.component';
import { TasadorComponent } from './modules/admin/views/tasador/tasador.component';
import { CotizaUsadoComponent } from './shared/components/cotiza-usado/cotiza-usado.component';
import { TicketsComponent } from './modules/admin/views/tickets/tickets.component';

const routes: Routes = [
    { path: '', redirectTo: 'inicio', pathMatch: 'prefix' },
  { path: 'inicio', component: LayoutShopComponent,
    //canActivate: [AuthGuard],
  },
  {
    path: 'gestiones',
    component: AdminLayoutComponent,
    canActivate: [AdminGuard],
    children: [
      { path: '', component: GestionesComponent }, 
      // Cada sección pide su permiso (ver core/secciones.ts)
      { path: 'clientes', component: ClientesComponent, canActivate: [PermisoGuard], data: { seccion: 'clientes' } },
      { path: 'solicitudes-mayoristas', component: SolicitudesMayoristasComponent, canActivate: [PermisoGuard], data: { seccion: 'clientes' } },
      { path: 'cuenta-taller', component: CuentaTallerComponent, canActivate: [PermisoGuard], data: { seccion: 'taller' } },
      { path: 'productos', component: ProductosComponent, canActivate: [PermisoGuard], data: { seccion: 'productos' } },
      { path: 'pedidos', component: PedidosComponent, canActivate: [PermisoGuard], data: { seccion: 'pedidos' } },
      { path: 'empresa', component: EmpresaComponent, canActivate: [PermisoGuard], data: { seccion: 'empresa' } },
      { path: 'gifts', component: GiftsComponent, canActivate: [PermisoGuard], data: { seccion: 'gifts' } },
      { path: 'taller', component: TallerComponent, canActivate: [PermisoGuard], data: { seccion: 'taller' } },
      { path: 'banner', component: BannerComponent, canActivate: [PermisoGuard], data: { seccion: 'banner' } },
      { path: 'caja', component: CajaComponent, canActivate: [PermisoGuard], data: { seccion: 'caja' } },
      { path: 'sucursales', component: SucursalesComponent, canActivate: [PermisoGuard], data: { seccion: 'sucursales' } },
      { path: 'marquesina', component: MarquesinaComponent, canActivate: [PermisoGuard], data: { seccion: 'marquesina' } },
      { path: 'auditoria', component: AuditoriaComponent, canActivate: [PermisoGuard], data: { seccion: 'auditoria' } },
      { path: 'tickets', component: TicketsComponent, canActivate: [PermisoGuard], data: { seccion: 'tickets' } },
      { path: 'dashboard', component: TableroComponent, canActivate: [PermisoGuard], data: { seccion: 'dashboard' } },
      // Mismo permiso que el Dashboard
      { path: 'analytics', component: AnalyticsTiendaComponent, canActivate: [PermisoGuard], data: { seccion: 'dashboard' } },
      { path: 'cajeros', component: CajerosComponent, canActivate: [PermisoGuard], data: { seccion: 'cajeros' } },
      { path: 'cuentas-corrientes', component: CuentasCorrientesComponent, canActivate: [PermisoGuard], data: { seccion: 'cuentas' } },
      { path: 'creditos', component: CreditosComponent, canActivate: [PermisoGuard], data: { seccion: 'cuentas' } },
      { path: 'equipos', component: EquiposComponent, canActivate: [PermisoGuard], data: { seccion: 'equipos' } },
      { path: 'tasador', component: TasadorComponent, canActivate: [PermisoGuard], data: { seccion: 'tasador' } },
      // Solo superadministrador
      { path: 'permisos', component: PermisosUsuariosComponent, canActivate: [SuperAdminGuard] },
    ]
  },
  {path:'productos',component: GrillaItemComponent},
  {path:'producto/:id',component:DetalleProductoComponent},
  {path: 'checkout',component: CheckoutComponent},
  {path: 'mi-cuenta',component: MiCuentaComponent},
  {path: 'despacho',component: LayoutDespachoComponent, canActivate: [AdminGuard, PermisoGuard], data: { seccion: 'despacho' }},
  {path: 'consulta/:id',component: ConsultaOrdenComponent},
  {path: 'cotiza-tu-usado', component: CotizaUsadoComponent},   // 🌐 solo si está habilitado (o para admins)
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
