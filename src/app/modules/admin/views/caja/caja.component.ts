import { Component, OnInit } from '@angular/core';
import { CajaService, Movimiento } from '../../services/caja.service';
import { SucursalesService } from '../../services/sucursales.service';
import { combineLatest, of, Subscription } from 'rxjs';
import { catchError, take } from 'rxjs/operators';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import Swal from 'sweetalert2';
import { CajaService as CajaDespachoService } from 'src/app/modules/despacho/services/caja.service';
import { InformeCierreService } from 'src/app/modules/despacho/services/informe-cierre.service';
import { MovimientosCajaService, nombreTipoMovimiento, signoMovimiento } from 'src/app/modules/despacho/services/movimientos-caja.service';
import { from } from 'rxjs';

interface TotalesPorMetodo {
  efectivo: number;
  tarjeta: number;
  transferencia: number;
  otros: number;
}

@Component({
  selector: 'app-caja',
  templateUrl: './caja.component.html',
  styleUrls: ['./caja.component.css']
})
export class CajaComponent implements OnInit {
  movimientos: Movimiento[] = [];       // los que se ven en la tabla (con filtros)
  private todosMovimientos: Movimiento[] = []; // todos los del día
  fechaSeleccionada: Date = new Date();
  displayedColumns: string[] = ['fecha', 'tipo', 'origen', 'descripcion', 'usuario', 'metodoPago', 'monto', 'acciones'];

  // Filtros del historial
  filtroUsuario = '';
  filtroTipo: '' | 'web' | 'local' | 'gasto' | 'movimiento' = '';
  filtroMetodo: '' | keyof TotalesPorMetodo = '';
  mostrarAnulados = true;
  usuariosDisponibles: string[] = [];
  cantidadAnulados = 0;

  // Cajas (aperturas / cierres) del día
  cajasDelDia: any[] = [];
  diferenciasDelDia = 0;

  // Cajas viejas que quedaron abiertas (de antes de que existiera el cierre)
  cajasPendientes: any[] = [];
  cerrandoPendientes = false;
  progresoPendientes = 0;

  // Carga de gastos
  mostrarFormGasto = false;
  guardandoGasto = false;
  formGasto: FormGroup;

  totalIngresos = 0;
  totalEgresos = 0;

  // Movimientos de efectivo de las cajas (no son ventas ni gastos: no van al saldo)
  movEfectivo = { ingresos: 0, retiros: 0, depositos: 0 };
  saldo = 0;

  // Desglose de ingresos
  totalWeb = 0;
  totalLocal = 0;
  cantidadWeb = 0;
  cantidadLocal = 0;
  porMetodo: TotalesPorMetodo = { efectivo: 0, tarjeta: 0, transferencia: 0, otros: 0 };

  cargando = false;
  private nombresSucursales: { [id: string]: string } = {};
  private sub?: Subscription;

  constructor(
    private cajaService: CajaService,
    private sucursalesService: SucursalesService,
    private fb: FormBuilder,
    private cajaDespacho: CajaDespachoService,
    private informeCierre: InformeCierreService,
    private movimientosCaja: MovimientosCajaService
  ) {
    this.formGasto = this.fb.group({
      fecha: [new Date(), Validators.required],
      concepto: ['', [Validators.required, Validators.maxLength(100)]],
      monto: [null, [Validators.required, Validators.min(0.01)]],
      observacion: ['', Validators.maxLength(300)]
    });
  }

  ngOnInit() {
    // Nombres de sucursales para mostrar en las ventas del local
    this.sucursalesService.obtenerSucursales().pipe(take(1)).subscribe(sucs => {
      (sucs || []).forEach(s => { if (s.id) this.nombresSucursales[s.id] = s.nombre; });
      this.cargarMovimientos(this.fechaSeleccionada);
      this.cargarCajasPendientes();
    });
  }

  async cargarCajasPendientes() {
    try {
      this.cajasPendientes = await this.cajaDespacho.buscarTodasLasCajasSinCerrar();
    } catch (err) {
      console.error('Error buscando cajas sin cerrar:', err);
      this.cajasPendientes = [];
    }
  }

  /**
   * Cierra TODAS las cajas de días anteriores que quedaron abiertas,
   * sin diferencias (contado = esperado) y marcadas como cierre administrativo.
   * No toca la caja de hoy.
   */
  async cerrarCajasPendientes() {
    if (!this.cajasPendientes.length || this.cerrandoPendientes) return;

    const cantidad = this.cajasPendientes.length;
    const desde = new Date(this.cajasPendientes[0].fechaApertura).toLocaleDateString('es-AR');
    const hasta = new Date(this.cajasPendientes[cantidad - 1].fechaApertura).toLocaleDateString('es-AR');

    const r = await Swal.fire({
      title: `¿Cerrar ${cantidad} caja${cantidad > 1 ? 's' : ''} pendiente${cantidad > 1 ? 's' : ''}?`,
      html: `Cajas abiertas del <strong>${desde}</strong> al <strong>${hasta}</strong>.<br><br>
             Se cierran <strong>sin diferencias</strong> (efectivo contado = esperado) y quedan
             marcadas como <strong>cierre administrativo</strong>.<br>
             La caja de hoy no se toca.<br><br>
             <small>Una vez cerradas no se pueden modificar.</small>`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Cerrar todas',
      cancelButtonText: 'Cancelar'
    });
    if (!r.isConfirmed) return;

    this.cerrandoPendientes = true;
    this.progresoPendientes = 0;
    const errores: string[] = [];

    for (const caja of [...this.cajasPendientes]) {
      try {
        await this.cajaDespacho.cerrarCajaAdministrativa(
          caja,
          'Cierre administrativo: caja de un día anterior que quedó abierta (antes de existir el cierre de caja).'
        );
      } catch (err: any) {
        // Si ya estaba cerrada (por ejemplo desde otra PC), no es un error
        if (!String(err?.message || '').startsWith('Esta caja ya fue cerrada')) {
          const fecha = new Date(caja.fechaApertura).toLocaleDateString('es-AR');
          errores.push(`${fecha} (${this.nombresSucursales[caja.sucursalId] || caja.sucursalId}): ${err?.message || err}`);
          console.error('Error cerrando caja pendiente', caja.id, err);
        }
      }
      this.progresoPendientes++;
    }

    this.cerrandoPendientes = false;
    await this.cargarCajasPendientes();
    this.cargarMovimientos(this.fechaSeleccionada);

    if (errores.length) {
      Swal.fire({
        title: 'Algunas cajas no se pudieron cerrar',
        html: `<ul style="text-align:left">${errores.map(e => `<li>${e}</li>`).join('')}</ul>`,
        icon: 'error'
      });
    } else {
      Swal.fire('Listo', `Se cerraron ${cantidad} caja${cantidad > 1 ? 's' : ''} pendiente${cantidad > 1 ? 's' : ''}.`, 'success');
    }
  }

  onFechaSeleccionada(event: any) {
    this.fechaSeleccionada = event.value;
    this.cargarMovimientos(this.fechaSeleccionada);
  }

  cargarMovimientos(fecha: Date) {
    const inicio = new Date(fecha);
    inicio.setHours(0, 0, 0, 0);

    const fin = new Date(fecha);
    fin.setHours(23, 59, 59, 999);

    this.cargando = true;
    this.sub?.unsubscribe();

    this.cargarCajasDelDia(inicio, fin);

    // 🔹 Ingresos web + ventas del local + egresos (si una fuente falla, las otras igual se muestran)
    const ingresosWeb$ = this.cajaService.getIngresos(inicio, fin).pipe(
      catchError(err => { console.error('Error cargando pedidos web:', err); return of([] as Movimiento[]); })
    );
    const ingresosLocal$ = this.cajaService.getIngresosLocal(inicio, fin).pipe(
      catchError(err => { console.error('Error cargando ventas del local:', err); return of([] as Movimiento[]); })
    );
    const egresos$ = this.cajaService.getEgresos(inicio, fin).pipe(
      catchError(err => { console.error('Error cargando gastos:', err); return of([] as Movimiento[]); })
    );

    const movCaja$ = from(this.movimientosCaja.listarEntre(inicio, fin)).pipe(
      catchError(err => { console.error('Error cargando movimientos de caja:', err); return of([] as any[]); })
    );

    this.sub = combineLatest([ingresosWeb$, ingresosLocal$, egresos$, movCaja$]).subscribe(([web, local, egresos, movCaja]) => {

      // Movimientos de caja (despacho) → formato del libro diario
      const movimientosCaja: Movimiento[] = (movCaja as any[]).map(m => ({
        id: m.id,
        tipo: signoMovimiento(m.tipo) > 0 ? 'ingreso' : 'egreso',
        descripcion: `${nombreTipoMovimiento(m.tipo)}: ${m.motivo}` +
          (m.proveedor ? ` (${m.proveedor})` : '') +
          (this.nombresSucursales[m.sucursalId] ? ` · ${this.nombresSucursales[m.sucursalId]}` : ''),
        monto: Number(m.importe) || 0,
        fecha: new Date(m.fecha),
        origen: 'movimiento',
        tipoMovimiento: m.tipo,
        metodoPago: 'efectivo',
        sucursalId: m.sucursalId,
        observacion: m.observaciones || '',
        usuario: m.usuario?.usuario || '',
        anulado: m.anulado === true,
        motivoAnulacion: m.motivoAnulacion || '',
        anuladoPor: m.anuladoPor?.usuario || ''
      } as Movimiento));

      const localConSucursal = local.map(m => ({
        ...m,
        descripcion: m.sucursalId && this.nombresSucursales[m.sucursalId]
          ? `${m.descripcion} · ${this.nombresSucursales[m.sucursalId]}`
          : m.descripcion
      }));

      const webConUsuario = web.map(m => ({ ...m, usuario: m.usuario || 'Web' }));

      // Unificar movimientos
      this.todosMovimientos = [
        ...webConUsuario.map(i => ({ ...i, tipo: 'ingreso' as 'ingreso' })),
        ...localConSucursal.map(i => ({ ...i, tipo: 'ingreso' as 'ingreso' })),
        ...egresos.map(e => ({ ...e, tipo: 'egreso' as 'egreso' })),
        ...movimientosCaja
      ].sort((a, b) => a.fecha.getTime() - b.fecha.getTime());

      this.usuariosDisponibles = [...new Set(this.todosMovimientos.map(m => m.usuario || '').filter(Boolean))].sort();
      if (this.filtroUsuario && !this.usuariosDisponibles.includes(this.filtroUsuario)) {
        this.filtroUsuario = '';
      }

      this.aplicarFiltros();
      this.cargando = false;
    });
  }

  /**
   * Aplica los filtros a la tabla y recalcula los totales.
   * Los totales respetan los filtros (ej: filtrando por usuario se ve lo que cobró ese usuario)
   * y NUNCA suman los movimientos anulados.
   */
  aplicarFiltros() {
    const coincide = (m: Movimiento) =>
      (!this.filtroUsuario || m.usuario === this.filtroUsuario) &&
      (!this.filtroTipo || m.origen === this.filtroTipo) &&
      (!this.filtroMetodo || (m.tipo === 'ingreso' && this.normalizarMetodo(m.metodoPago) === this.filtroMetodo));

    const filtrados = this.todosMovimientos.filter(coincide);
    const vigentes = filtrados.filter(m => !m.anulado);

    this.cantidadAnulados = filtrados.length - vigentes.length;
    this.movimientos = this.mostrarAnulados ? filtrados : vigentes;

    const web = vigentes.filter(m => m.origen === 'web');
    const local = vigentes.filter(m => m.origen === 'local');
    // Egresos = gastos generales + gastos y pagos a proveedores hechos con plata de la caja
    const egresos = vigentes.filter(m =>
      m.origen === 'gasto' ||
      (m.origen === 'movimiento' && (m.tipoMovimiento === 'gasto' || m.tipoMovimiento === 'proveedor'))
    );

    // Ingresos/retiros/depósitos de efectivo: se informan aparte (no son ventas ni gastos)
    const movs = vigentes.filter(m => m.origen === 'movimiento');
    this.movEfectivo = {
      ingresos: movs.filter(m => m.tipoMovimiento === 'ingreso').reduce((a, m) => a + m.monto, 0),
      retiros: movs.filter(m => m.tipoMovimiento === 'retiro').reduce((a, m) => a + m.monto, 0),
      depositos: movs.filter(m => m.tipoMovimiento === 'deposito').reduce((a, m) => a + m.monto, 0)
    };
    const ingresos = [...web, ...local];

    this.totalWeb = web.reduce((acc, m) => acc + m.monto, 0);
    this.totalLocal = local.reduce((acc, m) => acc + m.monto, 0);
    this.cantidadWeb = web.length;
    // Una venta con varios medios ocupa varios renglones: se cuentan ventas, no renglones
    this.cantidadLocal = new Set(local.map(m => m.ventaId || m.id)).size;

    this.totalIngresos = this.totalWeb + this.totalLocal;
    this.totalEgresos = egresos.reduce((acc, m) => acc + m.monto, 0);
    this.saldo = this.totalIngresos - this.totalEgresos;

    const porMetodo: TotalesPorMetodo = { efectivo: 0, tarjeta: 0, transferencia: 0, otros: 0 };
    for (const m of ingresos) {
      porMetodo[this.normalizarMetodo(m.metodoPago)] += m.monto;
    }
    this.porMetodo = porMetodo;
  }

  /** Aperturas y cierres de caja del día */
  async cargarCajasDelDia(inicio: Date, fin: Date) {
    try {
      const cajas = await this.cajaDespacho.obtenerCajasEntre(inicio, fin);
      this.cajasDelDia = cajas.map(c => ({
        ...c,
        nombreSucursal: this.nombresSucursales[c.sucursalId] || c.sucursalId || '-'
      }));
      this.diferenciasDelDia = this.cajasDelDia
        .filter(c => c.cierre)
        .reduce((acc, c) => acc + (Number(c.cierre.diferencia) || 0), 0);
    } catch (err) {
      console.error('Error cargando cajas del día:', err);
      this.cajasDelDia = [];
      this.diferenciasDelDia = 0;
    }
  }

  verInformeCierre(caja: any, formato: 'ticket' | 'a4') {
    this.informeCierre.abrir(caja, caja.nombreSucursal, formato);
  }

  get hayFiltros(): boolean {
    return !!(this.filtroUsuario || this.filtroTipo || this.filtroMetodo);
  }

  limpiarFiltros() {
    this.filtroUsuario = '';
    this.filtroTipo = '';
    this.filtroMetodo = '';
    this.aplicarFiltros();
  }

  /** Unifica los nombres de método de pago de la web y del local */
  normalizarMetodo(metodo?: string): keyof TotalesPorMetodo {
    const m = (metodo || '').toLowerCase();
    if (m.includes('efectivo')) return 'efectivo';
    if (m.includes('tarjeta')) return 'tarjeta';
    if (m.includes('transferencia') || m.includes('qr')) return 'transferencia';
    return 'otros';
  }

  etiquetaOrigen(origen?: string): string {
    if (origen === 'web') return 'Web';
    if (origen === 'local') return 'Local';
    if (origen === 'gasto') return 'Gasto';
    if (origen === 'movimiento') return 'Mov. caja';
    return '-';
  }

  // =====================================================
  // 💸 GASTOS
  // =====================================================

  abrirFormGasto() {
    this.formGasto.reset({
      fecha: this.fechaSeleccionada,   // por defecto, el día que se está mirando
      concepto: '',
      monto: null,
      observacion: ''
    });
    this.mostrarFormGasto = true;
  }

  cancelarGasto() {
    this.mostrarFormGasto = false;
  }

  async guardarGasto() {
    if (this.guardandoGasto) return;

    if (this.formGasto.invalid) {
      this.formGasto.markAllAsTouched();
      return;
    }

    const { fecha, concepto, monto, observacion } = this.formGasto.value;
    const fechaGasto = this.armarFechaGasto(new Date(fecha));

    this.guardandoGasto = true;
    try {
      await this.cajaService.agregarGasto({ fecha: fechaGasto, concepto, monto: Number(monto), observacion });

      this.mostrarFormGasto = false;

      // Mostramos la caja del día del gasto, para que se vea reflejado
      this.fechaSeleccionada = fechaGasto;
      this.cargarMovimientos(fechaGasto);

      Swal.fire({
        toast: true, position: 'top-end', icon: 'success',
        title: 'Gasto registrado', showConfirmButton: false, timer: 2000
      });
    } catch (err: any) {
      console.error('Error guardando gasto:', err);
      Swal.fire('Error', 'No se pudo registrar el gasto. ' + (err?.message || ''), 'error');
    } finally {
      this.guardandoGasto = false;
    }
  }

  /** Anular un gasto: NO se borra, queda registrado como anulado con motivo y usuario */
  async anularGasto(mov: Movimiento) {
    if (mov.origen !== 'gasto' || !mov.id || mov.anulado) return;

    const monto = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(mov.monto);
    const r = await Swal.fire({
      title: '¿Anular gasto?',
      html: `<strong>${mov.descripcion}</strong><br>${monto}<br><small>El gasto no se borra: queda registrado como anulado.</small>`,
      icon: 'warning',
      input: 'text',
      inputLabel: 'Motivo de la anulación',
      inputPlaceholder: 'Ej: cargado dos veces',
      inputValidator: (v: string) => (!v || v.trim().length < 3) ? 'Ingresá un motivo' : null,
      showCancelButton: true,
      confirmButtonText: 'Anular',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#d33'
    });
    if (!r.isConfirmed) return;

    try {
      await this.cajaService.anularGasto(mov.id, r.value);
      this.cargarMovimientos(this.fechaSeleccionada);
    } catch (err: any) {
      console.error('Error anulando gasto:', err);
      Swal.fire('Error', 'No se pudo anular el gasto.', 'error');
    }
  }

  /**
   * Si el gasto es de hoy, usamos la hora actual.
   * Si es de otro día, lo dejamos a las 12:00 (así nunca cae en el día anterior/siguiente).
   */
  private armarFechaGasto(fecha: Date): Date {
    const hoy = new Date();
    const esHoy = fecha.getFullYear() === hoy.getFullYear()
      && fecha.getMonth() === hoy.getMonth()
      && fecha.getDate() === hoy.getDate();

    const resultado = new Date(fecha);
    if (esHoy) {
      resultado.setHours(hoy.getHours(), hoy.getMinutes(), hoy.getSeconds(), 0);
    } else {
      resultado.setHours(12, 0, 0, 0);
    }
    return resultado;
  }
}
