import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { RegistroComponent } from '../views/registro/registro.component';
import { MatDialog } from '@angular/material/dialog';
import { Cliente } from '../models/cliente.model';
import { Auth, signInWithEmailAndPassword } from '@angular/fire/auth';
import { collection, doc, Firestore, getDoc, getDocs, query, where } from '@angular/fire/firestore';

@Injectable({
  providedIn: 'root'
})
export class AuthService {

  private clienteActual: Cliente | null = null;
  private readonly STORAGE_KEY = 'clienteActual';
  private clienteActualSubject = new BehaviorSubject<Cliente | null>(null);

  constructor(private dialog: MatDialog, private auth: Auth, private firestore: Firestore) {
    const data = localStorage.getItem(this.STORAGE_KEY);
    if (data) this.clienteActualSubject.next(JSON.parse(data));
  }

  openRegistroModal(): Observable<any> {
    const dialogRef = this.dialog.open(RegistroComponent, {
      width: '90vw',
      maxWidth: '950px',
      data: {},
    });

    return dialogRef.afterClosed();
  }

  async login(username: string, clave: string): Promise<Cliente | null> {
    
    const usuariosRef = collection(this.firestore, 'Clientes');
    const q = query(usuariosRef, where('usuario', '==', username));
    const snapshot = await getDocs(q);

    if (!snapshot.empty) {
      const data = snapshot.docs[0].data() as Cliente;
      const email = data.mail; // email registrado

      const cred = await signInWithEmailAndPassword(this.auth, email, clave);

      const ref = doc(this.firestore, 'Clientes', cred.user.uid);
      const userDoc = await getDoc(ref);

      return userDoc.exists() ? userDoc.data() as Cliente : null;
    } else {
      throw new Error('Nombre de usuario no encontrado');
    }
  }

  setUsuarioActual(cliente: Cliente): void {
    this.clienteActualSubject.next(cliente);
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(cliente));
  }

  getUsuarioActual(): Observable<Cliente | null> {
    return this.clienteActualSubject.asObservable();
  }

  getClienteActualValor(): Cliente | null {
    return this.clienteActualSubject.value;
  }

  estaLogueado(): boolean {
    return !!this.clienteActual;
  }

  logout(): void {
    this.clienteActualSubject.next(null);
    localStorage.removeItem(this.STORAGE_KEY);
  }

}
