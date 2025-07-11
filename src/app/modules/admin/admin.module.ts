import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AdminLayoutComponent } from './components/admin-layout/admin-layout/admin-layout.component';
import { EncabezadoComponent } from './views/encabezado/encabezado/encabezado.component';
import { GestionesComponent } from './views/gestiones/gestiones/gestiones.component';
import { ClientesComponent } from './views/clientes/clientes/clientes.component';
import { SharedModule } from 'src/app/shared/shared.module';
import { ProductosComponent } from './views/productos/productos.component';
import { AltaProductoComponent } from './views/productos/components/alta-producto/alta-producto.component';
import { ListaProductosComponent } from './views/productos/components/lista-productos/lista-productos.component';
import { EdicionProductoComponent } from './views/productos/components/edicion-producto/edicion-producto.component';
import { DetalleProductoComponent } from './views/productos/components/detalle-producto/detalle-producto.component';
import { ClientesEditarComponent } from './views/clientes/components/clientes-editar/clientes-editar.component';
import { ClientesDetallesComponent } from './views/clientes/components/clientes-detalles/clientes-detalles.component';
import { PedidosComponent } from './views/pedidos/pedidos.component';



@NgModule({
  declarations: [
    AdminLayoutComponent,
    EncabezadoComponent,
    GestionesComponent,
    ClientesComponent,
    ProductosComponent,
    AltaProductoComponent,
    ListaProductosComponent,
    EdicionProductoComponent,
    DetalleProductoComponent,
    ClientesEditarComponent,
    ClientesDetallesComponent,
    PedidosComponent
  ],
  imports: [
    CommonModule,
    SharedModule
  ]
})
export class AdminModule { }
