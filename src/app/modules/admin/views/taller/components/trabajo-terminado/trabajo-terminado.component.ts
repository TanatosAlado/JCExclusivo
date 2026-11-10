import { Component, Inject, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { CuentaTallerError, CuentaTallerService } from 'src/app/modules/despacho/services/cuenta-taller.service';
import { gananciaLocal, MAX_NOTA, SucursalRef, validarCosto } from 'src/app/modules/despacho/services/cuenta-taller';
import { desgloseDeOrden } from 'src/app/modules/despacho/services/desglose-reparacion';

/**
 * Taller → "Trabajo terminado": el técnico carga lo que el taller le cobra al local por la reparación.
 * La orden queda lista para retirar y el local le queda debiendo ese importe al taller.
 */
@Component({
  selector: 'app-trabajo-terminado',
  templateUrl: './trabajo-terminado.component.html',
  styleUrls: ['./trabajo-terminado.component.css']
})
export class TrabajoTerminadoComponent implements OnInit {

  cargando = true;
  guardando = false;
  error = '';
  errorConfig = '';

  taller: SucursalRef | null = null;
  deudoras: SucursalRef[] = [];
  deudorId = '';
  costo: number | null = null;
  nota = '';
  readonly maxNota = MAX_NOTA;

  constructor(
    @Inject(MAT_DIALOG_DATA) public orden: any,
    private dialogRef: MatDialogRef<TrabajoTerminadoComponent>,
    private cuentaTaller: CuentaTallerService
  ) { }

  async ngOnInit() {
    try {
      const cfg = await this.cuentaTaller.configuracion();
      this.taller = cfg.taller;
      this.deudoras = cfg.deudoras;
      if (!this.taller) {
        this.errorConfig = 'No encontré la sucursal del taller. En Gestiones → Sucursales tiene que haber una sola sucursal interna (sin retiro web), o una marcada como taller.';
      } else if (!this.deudoras.length) {
        this.errorConfig = 'No hay ninguna sucursal (local) que le pague al taller.';
      }
      if (this.deudoras.length === 1) this.deudorId = this.deudoras[0].id;
    } catch (err) {
      console.error(err);
      this.errorConfig = 'No se pudieron leer las sucursales. Probá de nuevo.';
    } finally {
      this.cargando = false;
    }
  }

  get presupuesto(): number {
    return Number(this.orden?.presupuesto) || 0;
  }

  get desglose() {
    return desgloseDeOrden(this.orden);
  }

  get ganancia(): number | null {
    return this.costo === null || (this.costo as any) === '' ? null : gananciaLocal(this.presupuesto, this.costo);
  }

  get errorCosto(): string | null {
    if (this.costo === null || (this.costo as any) === '') return null;
    try { validarCosto(this.costo); return null; } catch (e: any) { return e.message; }
  }

  get puedeGuardar(): boolean {
    return !!this.taller && !!this.deudorId && this.costo !== null && (this.costo as any) !== '' && !this.errorCosto && !this.guardando;
  }

  async guardar() {
    if (!this.puedeGuardar || !this.taller) return;
    this.guardando = true;
    this.error = '';
    try {
      const deudor = this.deudoras.find(d => d.id === this.deudorId)!;
      const trabajo = await this.cuentaTaller.terminarTrabajo(this.orden, {
        costo: this.costo, deudor, taller: this.taller, nota: this.nota
      });
      this.dialogRef.close(trabajo);
    } catch (err: any) {
      console.error(err);
      this.error = err instanceof CuentaTallerError ? err.message : 'No se pudo guardar. Probá de nuevo.';
    } finally {
      this.guardando = false;
    }
  }

  cerrar() {
    this.dialogRef.close(null);
  }
}
