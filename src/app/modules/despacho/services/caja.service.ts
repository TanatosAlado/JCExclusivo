import { Injectable } from '@angular/core';
import { Firestore, collection, query, where, getDocs, addDoc, updateDoc, doc } from '@angular/fire/firestore';

@Injectable({ providedIn: 'root' })
export class CajaService {
  private readonly STORAGE_KEY = 'cajaActiva';

  constructor(private firestore: Firestore) {}

  /** Obtener caja activa de localStorage */
  getCajaActiva(): any | null {
    const data = localStorage.getItem(this.STORAGE_KEY);
    return data ? JSON.parse(data) : null;
  }

  /** Guardar caja activa en localStorage */
  setCajaActiva(caja: any) {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(caja));
  }

  /** Limpiar caja activa (al cerrar) */
  clearCajaActiva() {
    localStorage.removeItem(this.STORAGE_KEY);
  }

  // /** Verificar en Firestore si hay una caja abierta para la sucursal */
  // async verificarCajaAbierta(sucursalId: string) {
  //   const cajasRef = collection(this.firestore, 'Cajas');
  //   const q = query(cajasRef, where('sucursalId', '==', sucursalId), where('abierta', '==', true));
  //   const snap = await getDocs(q);

  //   if (!snap.empty) {
  //     const caja = { id: snap.docs[0].id, ...snap.docs[0].data() };
  //     this.setCajaActiva(caja); // sincronizar en local
  //     return caja;
  //   }

  //   this.clearCajaActiva();
  //   return null;
  // }

  async verificarCajaAbierta(sucursalId: string) {
  const hoy = new Date();
  const fechaHoy = hoy.toISOString().split("T")[0]; // 👉 "2025-10-06"

  const cajasRef = collection(this.firestore, 'Cajas');
  const q = query(
    cajasRef,
    where('sucursalId', '==', sucursalId),
    where('abierta', '==', true)
  );

  const snap = await getDocs(q);

  if (!snap.empty) {
    // buscamos si alguna caja tiene la fechaApertura de HOY
    const cajaHoy = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .find(caja => (caja as any).fechaApertura?.startsWith(fechaHoy));

    if (cajaHoy) {
      console.log("✅ Caja abierta:", cajaHoy);
      return cajaHoy;
    }
  }

  console.log("❌ Caja cerrada");
  return null;
}

  /** Abrir caja */
  async abrirCaja(sucursalId: string, usuarioId: string, montoInicial: number) {
    const hoy = new Date();
    const inicioDia = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 0, 0, 0);
    const finDia = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 23, 59, 59);

    // 1) Consultar si ya existe una caja para esta sucursal hoy
    const cajasRef = collection(this.firestore, 'Cajas');
    const q = query(
      cajasRef,
      where('sucursalId', '==', sucursalId),
      where('fechaApertura', '>=', inicioDia.toISOString()),
      where('fechaApertura', '<=', finDia.toISOString())
    );

    const snapshot = await getDocs(q);
    if (!snapshot.empty) {
      throw new Error('Ya existe una caja abierta hoy para esta sucursal');
    }

    // 2) Crear caja
    const nuevaCaja = {
      sucursalId,
      usuarioId,
      montoInicial,
      fechaApertura: hoy.toISOString(),
      abierta: true
    };

    return await addDoc(cajasRef, nuevaCaja);
  }

  /** Cerrar caja */
  async cerrarCaja(cajaId: string, montoFinal: number) {
    const cajaRef = doc(this.firestore, 'Cajas', cajaId);
    await updateDoc(cajaRef, {
      fechaCierre: new Date().toISOString(),
      montoCierre: montoFinal,
      abierta: false
    });
    this.clearCajaActiva();
  }

  getCajaActivaLocalValidada(): any | null {
  const raw = localStorage.getItem(this.STORAGE_KEY);
  if (!raw) return null;
  try {
    const caja = JSON.parse(raw);
    if (this.esMismoDiaLocal(caja.fechaApertura)) {
      return caja;
    } else {
      // si la fecha NO es de hoy, limpiamos la cache local
      this.clearCajaActiva();
      return null;
    }
  } catch (err) {
    // si no se puede parsear, limpiamos por seguridad
    this.clearCajaActiva();
    return null;
  }
}

/** Normaliza distintos tipos de fecha y dice si la fecha corresponde a hoy */
private esMismoDiaLocal(fechaAny: any): boolean {
  if (!fechaAny) return false;
  let d: Date;
  // Firestore Timestamp (tiene toDate)
  if (fechaAny && typeof fechaAny.toDate === 'function') {
    d = fechaAny.toDate();
  } else if (fechaAny && typeof fechaAny.seconds === 'number') {
    d = new Date(fechaAny.seconds * 1000);
  } else if (typeof fechaAny === 'string') {
    d = new Date(fechaAny);
  } else if (fechaAny instanceof Date) {
    d = fechaAny;
  } else {
    d = new Date(fechaAny);
  }
  if (isNaN(d.getTime())) return false;
  const now = new Date();
  return d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
}
}
