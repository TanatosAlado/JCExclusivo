import { inject, Injectable } from '@angular/core';
import { LoginRequest } from '../models/loginRequest.model';
import { from, map, Observable } from 'rxjs';
import { Cliente } from '../models/cliente.model';
import { collection, Firestore, getDocs, query, where } from '@angular/fire/firestore';
import { RegistroComponent } from '../views/registro/registro.component';
import { MatDialog } from '@angular/material/dialog';

@Injectable({
  providedIn: 'root'
})
export class AuthService {

  private firestore = inject(Firestore);
  constructor(private dialog: MatDialog) { }

  getClienteByLogin(ingresante: LoginRequest): Observable<Cliente> {
    const clientesRef = collection(this.firestore, 'Clientes');
    const q = query(clientesRef, where('usuario', '==', ingresante.user), where('contrasena', '==', ingresante.password));

    return from(getDocs(q)).pipe(
      map(snapshot => {
        const clientes = snapshot.docs.map(doc => {
          const data = doc.data() as Cliente;
          return new Cliente(
            doc.id,
            data.usuario,
            data.contrasena,
            data.mail,
            data.telefono,
            data.direccion,
            data.historial,
            data.estado,
            data.razonSocial,
            data.nombre,
            data.apellido,
            data.administrador,
            data.carrito,
            data.dni,
            data.cuit,
            data.puntos
          );
        });
        return clientes.length > 0 ? clientes[0] : null;
      })
    );
  }

  openRegistroModal(): Observable<any> {
    const dialogRef = this.dialog.open(RegistroComponent, {
      width: '90vw',
      maxWidth: '950px',
      data: {},
    });
  
    return dialogRef.afterClosed(); 
  }
}
