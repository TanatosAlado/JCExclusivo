import { Component, OnInit } from '@angular/core';
import Swal from 'sweetalert2';
import { CuentaTallerError, CuentaTallerService } from 'src/app/modules/despacho/services/cuenta-taller.service';
import { gananciaLocal, MetodoPagoInterno, SucursalRef } from 'src/app/modules/despacho/services/cuenta-taller';

/**
 * Gestiones → Cuenta Local – Taller.
 * Lo que el local le debe al taller por las reparaciones terminadas, y los pagos (efectivo entre cajas o transferencia).
 */
@Component({
  selector: 'app-cuenta-taller',
  templateUrl: './cuenta-taller.component.html',
  styleUrls: ['./cuenta-taller.component.css']
})
export class CuentaTallerComponent implements OnInit {

  cargando = true;
  error = '';
  taller: SucursalRef | null = null;
  deudoras: SucursalRef[] = [];

  cuentas: any[] = [];
  cuenta: any = null;
  movimientos: any[] = [];
  cargandoMovs = false;
  vista: 'pendientes' | 'todas' | 'pagos' = 'pendientes';
  procesando = false;

  constructor(private servicio: CuentaTallerService) { }

  async ngOnInit() {
    await this.cargar();
  }

  async cargar() {
    this.cargando = true;
    this.error = '';
    try {
      const [cfg, cuentas] = await Promise.all([this.servicio.configuracion(), this.servicio.cuentas()]);
      this.taller = cfg.taller;
      this.deudoras = cfg.deudoras;
      this.cuentas = cuentas.filter(c => !this.taller || c.acreedor?.id === this.taller.id);
      const actual = this.cuenta && this.cuentas.find(c => c.id === this.cuenta.id);
      this.cuenta = actual || this.cuentas[0] || null;
      if (this.cuenta) await this.cargarMovimientos();
      else this.movimientos = [];
    } catch (err) {
      console.error(err);
      this.error = 'No se pudo cargar la cuenta. Probá de nuevo.';
    } finally {
      this.cargando = false;
    }
  }

  async elegirCuenta(c: any) {
    this.cuenta = c;
    await this.cargarMovimientos();
  }

  async cargarMovimientos() {
    if (!this.cuenta) return;
    this.cargandoMovs = true;
    try {
      this.movimientos = await this.servicio.movimientos(this.cuenta.id);
    } finally {
      this.cargandoMovs = false;
    }
  }

  // ---------- Listas ----------

  get cargos(): any[] {
    return this.movimientos.filter(m => m.tipo === 'cargo');
  }

  get cargosPendientes(): any[] {
    return this.cargos.filter(c => !c.anulado && (Number(c.pendiente) || 0) > 0)
      .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
  }

  get pagos(): any[] {
    return this.movimientos.filter(m => m.tipo === 'pago');
  }

  get listaCargos(): any[] {
    return this.vista === 'pendientes' ? this.cargosPendientes : this.cargos;
  }

  get resumen() {
    const vigentes = this.cargos.filter(c => !c.anulado);
    const presupuesto = vigentes.reduce((a, c) => a + (Number(c.presupuesto) || 0), 0);
    const costo = vigentes.reduce((a, c) => a + (Number(c.importe) || 0), 0);
    return { ordenes: vigentes.length, presupuesto, costo, ganancia: presupuesto - costo,
      pendientes: this.cargosPendientes.length };
  }

  ganancia(c: any): number {
    return gananciaLocal(c.presupuesto, c.importe);
  }

  estadoCargo(c: any): 'anulado' | 'pagado' | 'parcial' | 'pendiente' {
    if (c.anulado) return 'anulado';
    const p = Number(c.pendiente) || 0, i = Number(c.importe) || 0;
    return p <= 0.004 ? 'pagado' : p < i - 0.004 ? 'parcial' : 'pendiente';
  }

  sinPagos(c: any): boolean {
    return !c.anulado && Math.abs((Number(c.pendiente) || 0) - (Number(c.importe) || 0)) < 0.005;
  }

  // ---------- Acciones ----------

  private moneda(n: number): string {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(Number(n) || 0);
  }

  private esc(s: any): string {
    return String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as any)[ch]);
  }

  async pagar() {
    if (!this.cuenta || this.procesando) return;
    const saldo = Number(this.cuenta.saldo) || 0;
    const r = await Swal.fire({
      title: `Pago a ${this.esc(this.cuenta.acreedor?.nombre)}`,
      html: `
        <div style="text-align:left">
          <div style="margin-bottom:8px">${this.esc(this.cuenta.deudor?.nombre)} debe <b>${this.moneda(saldo)}</b></div>
          <label style="font-size:13px;color:#555">Importe</label>
          <input id="ctImporte" type="number" min="0" step="0.01" class="swal2-input" style="margin:4px 0 10px;width:100%" value="${saldo.toFixed(2)}">
          <label style="font-size:13px;color:#555">Cómo se paga</label>
          <select id="ctMetodo" class="swal2-select" style="margin:4px 0 10px;width:100%;display:block">
            <option value="efectivo">Efectivo (sale de la caja de ${this.esc(this.cuenta.deudor?.nombre)} y entra en la de ${this.esc(this.cuenta.acreedor?.nombre)})</option>
            <option value="transferencia">Transferencia (no mueve las cajas)</option>
          </select>
          <label style="font-size:13px;color:#555">Nota (opcional)</label>
          <input id="ctNota" class="swal2-input" style="margin:4px 0 0;width:100%" maxlength="300">
          <div style="font-size:12px;color:#777;margin-top:8px">Se cancelan primero las órdenes más viejas.</div>
        </div>`,
      showCancelButton: true,
      confirmButtonText: 'Registrar pago',
      cancelButtonText: 'Cancelar',
      focusConfirm: false,
      preConfirm: () => {
        const importe = Number((document.getElementById('ctImporte') as HTMLInputElement).value);
        if (!(importe > 0)) { Swal.showValidationMessage('Ingresá un importe mayor a 0.'); return false; }
        if (importe > saldo + 0.009) { Swal.showValidationMessage(`No puede superar lo que se debe (${this.moneda(saldo)}).`); return false; }
        return {
          importe,
          metodo: (document.getElementById('ctMetodo') as HTMLSelectElement).value as MetodoPagoInterno,
          nota: (document.getElementById('ctNota') as HTMLInputElement).value
        };
      }
    });
    if (!r.isConfirmed || !r.value) return;
    await this.ejecutar(() => this.servicio.pagar(this.cuenta, r.value), 'Pago registrado');
  }

  async anularPago(p: any) {
    const r = await Swal.fire({
      title: 'Anular pago',
      html: `Pago de <b>${this.moneda(p.importe)}</b> (${p.metodo}) del ${new Date(p.fecha).toLocaleDateString('es-AR')}.` +
        (p.metodo === 'efectivo' ? '<br>También se anulan los dos movimientos de caja (las cajas tienen que seguir abiertas).' : ''),
      input: 'text',
      inputLabel: 'Motivo',
      showCancelButton: true,
      confirmButtonText: 'Anular',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#d03b3b',
      inputValidator: (v: string) => (!v || v.trim().length < 3) ? 'Escribí el motivo.' : null
    });
    if (!r.isConfirmed) return;
    await this.ejecutar(() => this.servicio.anularPago(this.cuenta, p, r.value), 'Pago anulado');
  }

  async corregir(c: any) {
    const r = await Swal.fire({
      title: `Costo del taller · orden #${c.numeroOrden}`,
      html: `
        <div style="text-align:left">
          <div style="margin-bottom:8px">${this.esc(c.equipo)} · ${this.esc(c.cliente)}<br>Costo actual: <b>${this.moneda(c.importe)}</b></div>
          <label style="font-size:13px;color:#555">Nuevo costo (0 = anularlo)</label>
          <input id="ctCosto" type="number" min="0" step="0.01" class="swal2-input" style="margin:4px 0 10px;width:100%" value="${Number(c.importe).toFixed(2)}">
          <label style="font-size:13px;color:#555">Motivo</label>
          <input id="ctMotivo" class="swal2-input" style="margin:4px 0 0;width:100%" maxlength="200">
        </div>`,
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      cancelButtonText: 'Cancelar',
      focusConfirm: false,
      preConfirm: () => {
        const costo = (document.getElementById('ctCosto') as HTMLInputElement).value;
        const motivo = (document.getElementById('ctMotivo') as HTMLInputElement).value;
        if (costo === '' || Number(costo) < 0) { Swal.showValidationMessage('Ingresá un costo de 0 o más.'); return false; }
        if (!motivo || motivo.trim().length < 3) { Swal.showValidationMessage('Escribí el motivo.'); return false; }
        return { costo, motivo };
      }
    });
    if (!r.isConfirmed || !r.value) return;
    await this.ejecutar(() => this.servicio.corregirCargo(this.cuenta, c, r.value.costo, r.value.motivo), 'Costo corregido');
  }

  private async ejecutar(accion: () => Promise<any>, ok: string) {
    this.procesando = true;
    try {
      await accion();
      Swal.fire({ toast: true, position: 'top-end', timer: 2500, showConfirmButton: false, icon: 'success', title: ok });
      await this.cargar();
    } catch (err: any) {
      console.error(err);
      Swal.fire('No se pudo completar', err instanceof CuentaTallerError ? err.message : 'Probá de nuevo.', 'error');
      await this.cargar();
    } finally {
      this.procesando = false;
    }
  }

  trackId = (_: number, m: any) => m.id;
}
