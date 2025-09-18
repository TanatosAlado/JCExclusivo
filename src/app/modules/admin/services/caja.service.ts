// caja.service.ts
import { Injectable } from '@angular/core';
import { Firestore, collection, query, where, getDocs, Timestamp, addDoc, collectionData, updateDoc, deleteDoc, doc } from '@angular/fire/firestore';
import { from, map, Observable } from 'rxjs';
import { Gasto } from '../models/gasto.model';

export interface Movimiento {
  id?: string;
  tipo: 'ingreso' | 'egreso';
  descripcion: string;
  monto: number;
  fecha: Date;
}

@Injectable({
  providedIn: 'root'
})
export class CajaService {

  private gastosRef;

  constructor(private firestore: Firestore) {
    this.gastosRef = collection(this.firestore, 'Gastos');
  }

getIngresos(fechaInicio: Date, fechaFin: Date) {
  console.log('getIngresos called with:', fechaInicio, fechaFin);

  const pedidosRef = collection(this.firestore, 'Pedidos Finalizados');

  return from(getDocs(pedidosRef)).pipe(
    map(snapshot => {
      const docs = snapshot.docs.map(doc => {
        const data: any = doc.data();

        const fecha = data.fecha ? this.parseFecha(data.fecha) : null;

        return <Movimiento>{
          id: doc.id,
          tipo: 'ingreso',
          descripcion: `Pedido #${data.nroPedido} - ${data.nombreCliente} ${data.apellidoCliente}`,
          monto: data.total ?? 0,
          fecha
        };
      });

      return docs.filter(m =>
        m.fecha &&
        m.fecha >= fechaInicio &&
        m.fecha <= fechaFin
      );
    })
  );
}

// Función auxiliar (afuera de la clase)
parseFecha(fechaStr: string): Date {
  const [fechaPart, horaPart] = fechaStr.split(' ');
  const [dia, mes, anio] = fechaPart.split('/').map(Number);
  const [hora, minuto] = horaPart.split(':').map(Number);
  return new Date(anio, mes - 1, dia, hora, minuto);
}

  // 🔹 Obtener egresos (gastos cargados)
  getEgresos(fechaInicio: Date, fechaFin: Date) {
    const gastosRef = collection(this.firestore, 'gastos');
    const q = query(
      gastosRef,
      where('fecha', '>=', Timestamp.fromDate(fechaInicio)),
      where('fecha', '<=', Timestamp.fromDate(fechaFin))
    );

    return from(getDocs(q)).pipe(
      map(snapshot =>
        snapshot.docs.map(doc => {
          const data: any = doc.data();
          return <Movimiento>{
            id: doc.id,
            tipo: 'egreso',
            descripcion: data.descripcion ?? 'Gasto',
            monto: data.monto ?? 0,
            fecha: data.fecha.toDate()
          };
        })
      )
    );
  }

agregarGasto(gasto: Gasto) {
    const nuevoGasto = {
      ...gasto,
      creadoEn: new Date(),
      actualizadoEn: new Date()
    };
    return addDoc(this.gastosRef, nuevoGasto);
  }

  obtenerGastos(): Observable<Gasto[]> {
    return collectionData(this.gastosRef, { idField: 'id' }) as Observable<Gasto[]>;
  }

  actualizarGasto(id: string, gasto: Partial<Gasto>) {
    const gastoDoc = doc(this.firestore, `Gastos/${id}`);
    return updateDoc(gastoDoc, { ...gasto, actualizadoEn: new Date() });
  }

  eliminarGasto(id: string) {
    const gastoDoc = doc(this.firestore, `Gastos/${id}`);
    return deleteDoc(gastoDoc);
  }



}