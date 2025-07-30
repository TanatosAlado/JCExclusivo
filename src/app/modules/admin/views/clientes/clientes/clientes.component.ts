import { Component, OnInit, ViewChild } from '@angular/core';
import { collection, collectionData, Firestore } from '@angular/fire/firestore';
import { MatDialog } from '@angular/material/dialog';
import { Cliente } from 'src/app/modules/auth/models/cliente.model'; 
import { ClientesDetallesComponent } from '../components/clientes-detalles/clientes-detalles.component';
import { ClientesEditarComponent } from '../components/clientes-editar/clientes-editar.component';
import { ClientesService } from 'src/app/shared/services/clientes.service';
import { MatTableDataSource } from '@angular/material/table';
import { MatPaginator } from '@angular/material/paginator';
import { ConfirmDialogComponent } from 'src/app/shared/components/confirm-dialog/confirm-dialog.component';
import { ToastService } from 'src/app/shared/services/toast.service';

@Component({
  selector: 'app-clientes',
  templateUrl: './clientes.component.html',
  styleUrls: ['./clientes.component.css']
})
export class ClientesComponent {

  clientes: Cliente[] = [];
  clientesFiltrados: Cliente[] = [];
  filtro: 'todos' | 'mayorista' | 'minorista' = 'todos';
  displayedColumns: string[] = ['nombre', 'usuario', 'mail', 'telefono', 'acciones'];
  datasourceClientes: MatTableDataSource<Cliente>
  paginator!: MatPaginator;
  // toastService: any;
public clienteAEliminar: string = '';

  constructor(private firestore: Firestore, private dialog: MatDialog, private clienteService:ClientesService, private toastService:ToastService) {}

  ngOnInit() {
    // const clientesRef = collection(this.firestore, 'Clientes');
    // collectionData(clientesRef, { idField: 'id' }).subscribe((data: any[]) => {
    //   this.clientes = data.map(c => new Cliente(
    //     c.id, c.usuario, c.mail, c.telefono, c.direccion,
    //     c.historial, c.estado, c.nombre, c.apellido,
    //     c.administrador, c.carrito, c.dni, c.puntos,
    //     c.esMayorista, c.razonSocial, c.cuit
    //   ));
    //   this.aplicarFiltro();
    // });
    this.loadClientes()
  }

    ngAfterViewInit() {
    this.setDataSourceAttributes()
  }


 @ViewChild(MatPaginator) set matPaginator(mp: MatPaginator) {
      if (mp) {
        this.paginator = mp;
        this.paginator._intl.itemsPerPageLabel = 'Clientes por Página';
        this.paginator._intl.firstPageLabel = 'Primera Página';
        this.paginator._intl.previousPageLabel = 'Página Anterior';
        this.paginator._intl.nextPageLabel = 'Siguiente Página';
        this.paginator._intl.lastPageLabel = 'Última Página';
      }
      this.setDataSourceAttributes();
    }


    setDataSourceAttributes() {
    if (this.datasourceClientes) {
      this.datasourceClientes.paginator = this.paginator;
    }
  }

 loadClientes() {
  this.clienteService.getClientes().subscribe((clientes: Cliente[]) => {
    console.log('Clientes recibidos:', clientes);
    this.clientes = clientes;
    this.aplicarFiltro(); 
  });
}

 aplicarFiltro() {
  if (this.filtro === 'mayorista') {
    this.clientesFiltrados = this.clientes.filter(c => c.esMayorista);
  } else if (this.filtro === 'minorista') {
    this.clientesFiltrados = this.clientes.filter(c => !c.esMayorista);
  } else {
    this.clientesFiltrados = this.clientes;
  }
  this.datasourceClientes = new MatTableDataSource(this.clientesFiltrados);
  this.datasourceClientes.paginator = this.paginator;
}

  onFiltroChange(filtro: 'todos' | 'mayorista' | 'minorista') {
    this.filtro = filtro;
    this.aplicarFiltro();
  }

verCliente(cliente: Cliente) {
  this.dialog.open(ClientesDetallesComponent, {
    width: '500px',
    data: cliente
  });
}

editarCliente(cliente: Cliente) {
  const dialogRef = this.dialog.open(ClientesEditarComponent, {
        width: '600px',
        data: cliente,  // Enviar los datos del producto a editar
      });
  
      dialogRef.afterClosed().subscribe((resultado) => {
        if (resultado) {
          this.clienteService.actualizarCliente(resultado.id,resultado)
          .then(() => {
            this.obtenerProductos(); // Refrescar la lista después de cerrar el modal
          })
          .catch(error => {
          });
        }
      });
}

      //FUNCION PARA FILTRAR POR CUALQUIER PALABRA QUE SE ESCRIBA EN EL FILTRO
  applyFilter(event: Event, datasource: MatTableDataSource<any>) {
    const filterValue = (event.target as HTMLInputElement).value;
    datasource.filter = filterValue.trim().toLowerCase();
  }

  openConfirmDialog(cliente: any): void {
    this.clienteAEliminar = cliente.id;
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        message: `¿Está seguro que desea eliminar este cliente: ${cliente.nombre}?`,
        confirmAction: () => this.eliminarCliente(cliente.id) // Acción a ejecutar si se confirma
      }
    });
  }

   eliminarCliente(idCliente: string): void {
    this.clienteService.eliminarCliente(idCliente).then(() => {
       this.toastService.toastMessage('Cliente eliminado con éxito', 'green', 2000);
    })
  }

obtenerProductos(){}

}