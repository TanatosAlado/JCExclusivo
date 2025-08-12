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
import { EmpresaComponent } from './views/empresa/empresa.component';
import { GiftsComponent } from './views/gifts/gifts.component';
import { TallerComponent } from './views/taller/taller.component';
import { ListaOrdenesComponent } from './views/taller/components/lista-ordenes/lista-ordenes.component';
import { AltaOrdenComponent } from './views/taller/components/alta-orden/alta-orden.component';
import { DetalleOrdenComponent } from './views/taller/components/detalle-orden/detalle-orden.component';
import { EdicionOrdenComponent } from './views/taller/components/edicion-orden/edicion-orden.component';
import { VerOrdenComponent } from './views/taller/components/ver-orden/ver-orden.component';



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
    PedidosComponent,
    EmpresaComponent,
    GiftsComponent,
    TallerComponent,
    ListaOrdenesComponent,
    AltaOrdenComponent,
    DetalleOrdenComponent,
    EdicionOrdenComponent,
    VerOrdenComponent
  ],
  imports: [
    CommonModule,
    SharedModule
  ]
})
export class AdminModule { }
