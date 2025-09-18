import { Component, OnInit } from '@angular/core';
import { CajaService, Movimiento } from '../../services/caja.service';
import { combineLatest } from 'rxjs';

@Component({
  selector: 'app-caja',
  templateUrl: './caja.component.html',
  styleUrls: ['./caja.component.css']
})
export class CajaComponent implements OnInit {
  movimientos: Movimiento[] = [];
  fechaSeleccionada: Date = new Date();
  displayedColumns: string[] = ['fecha', 'tipo', 'descripcion', 'monto'];

  totalIngresos = 0;
  totalEgresos = 0;
  saldo = 0;

  constructor(private cajaService: CajaService) { }

  ngOnInit() {
    this.cargarMovimientos(this.fechaSeleccionada);
  }

  onFechaSeleccionada(event: any) {
    this.fechaSeleccionada = event.value;
    console.log('Fecha seleccionada:', this.fechaSeleccionada);
    console.log('Event', event);
    this.cargarMovimientos(this.fechaSeleccionada);
  }

  cargarMovimientos(fecha: Date) {
    const inicio = new Date(fecha);
    inicio.setHours(0, 0, 0, 0);

    const fin = new Date(fecha);
    fin.setHours(23, 59, 59, 999);

    // 🔹 Obtener ingresos y egresos del rango
    const ingresos$ = this.cajaService.getIngresos(inicio, fin);
    const egresos$ = this.cajaService.getEgresos(inicio, fin);

    combineLatest([ingresos$, egresos$]).subscribe(([ingresos, egresos]) => {
      // Unificar movimientos
      this.movimientos = [
        ...ingresos.map(i => ({ ...i, tipo: 'ingreso' as 'ingreso' })),
        ...egresos.map(e => ({
          id: e.id,
          fecha: e.fecha,
          monto: e.monto,
          descripcion: e.descripcion,
          tipo: 'egreso' as 'egreso'
        }))
      ].sort((a, b) => a.fecha.getTime() - b.fecha.getTime());

      // Calcular totales
      this.totalIngresos = ingresos.reduce((acc, m) => acc + m.monto, 0);
      this.totalEgresos = egresos.reduce((acc, m) => acc + m.monto, 0);
      this.saldo = this.totalIngresos - this.totalEgresos;
    });
  }

  abrirModalGasto() {
    console.log('Abrir modal nuevo gasto');
    // más adelante implementamos el modal
  }
}
