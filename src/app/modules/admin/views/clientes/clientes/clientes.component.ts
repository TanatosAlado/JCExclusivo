import { Component, OnInit } from '@angular/core';
import { collection, collectionData, Firestore } from '@angular/fire/firestore';
import { MatDialog } from '@angular/material/dialog';
import { Cliente } from 'src/app/modules/auth/models/cliente.model'; 
import { ClientesDetallesComponent } from '../components/clientes-detalles/clientes-detalles.component';

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


  constructor(private firestore: Firestore, private dialog: MatDialog) {}

  ngOnInit() {
    const clientesRef = collection(this.firestore, 'Clientes');
    collectionData(clientesRef, { idField: 'id' }).subscribe((data: any[]) => {
      this.clientes = data.map(c => new Cliente(
        c.id, c.usuario, c.mail, c.telefono, c.direccion,
        c.historial, c.estado, c.nombre, c.apellido,
        c.administrador, c.carrito, c.dni, c.puntos,
        c.esMayorista, c.razonSocial, c.cuit
      ));
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
  console.log('Editar cliente:', cliente);
  // Acá podrías abrir un formulario con los datos pre-cargados
}

eliminarCliente(cliente: Cliente) {
  console.log('Eliminar cliente:', cliente);
  // Confirmar y luego eliminar
}
}