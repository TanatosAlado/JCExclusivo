import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';

@Component({
  selector: 'app-consulta-orden',
  templateUrl: './consulta-orden.component.html',
  styleUrls: ['./consulta-orden.component.css']
})
export class ConsultaOrdenComponent {

ordenId!: string;
  orden: any = null;
  cargando = true;
  error: string | null = null;

  constructor(
    private route: ActivatedRoute,
    private firestore: Firestore
  ) {}

  async ngOnInit() {
    this.ordenId = this.route.snapshot.paramMap.get('id')!;

    try {
      const ref = doc(this.firestore, `Ordenes Pendientes/${this.ordenId}`);
      const snap = await getDoc(ref);

      if (snap.exists()) {
        this.orden = snap.data();
        console.log('Orden encontrada:', this.orden);
        this.orden.fechaIngreso = this.orden.fechaIngreso.toDate(); 
        console.log('Fecha de ingreso convertida:', this.orden.fechaIngreso);
      } else {
        this.error = 'No se encontró la orden solicitada.';
      }
    } catch (err) {
      console.error(err);
      this.error = 'Error al consultar la orden.';
    } finally {
      this.cargando = false;
    }
  }
}
