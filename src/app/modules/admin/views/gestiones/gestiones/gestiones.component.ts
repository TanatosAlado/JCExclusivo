import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from 'src/app/modules/auth/services/auth.service';
import { PermisosService } from 'src/app/core/permisos.service';
import { seccionDeRuta } from 'src/app/core/secciones';
import { SolicitudesMayoristasService } from '../../../services/solicitudes-mayoristas.service';

/** Card solo para el superadministrador */
const CARD_PERMISOS = {
  titulo: 'Permisos de usuarios',
  descripcion: 'Qué secciones ve cada administrador',
  icono: 'fa-solid fa-user-lock',
  ruta: '/gestiones/permisos',
};

@Component({
  selector: 'app-gestiones',
  templateUrl: './gestiones.component.html',
  styleUrls: ['./gestiones.component.css']
})
export class GestionesComponent {

  gestiones = [
    {
      titulo: 'Dashboard',
      descripcion: 'Ventas, caja, stock y taller de un vistazo + reporte Excel',
      icono: 'fas fa-chart-line',
      ruta: '/gestiones/dashboard',
    },
    {
      titulo: 'Analytics de la tienda',
      descripcion: 'Visitas, embudo de compra, productos más vistos y búsquedas de la tienda online',
      icono: 'fas fa-chart-pie',
      ruta: '/gestiones/analytics',
      seccion: 'dashboard',   // mismo permiso que el Dashboard
    },
    {
      titulo: 'Cuenta Local – Taller',
      descripcion: 'Lo que el local le debe al taller por las reparaciones, y los pagos entre ellos',
      icono: 'fas fa-handshake',
      ruta: '/gestiones/cuenta-taller',
      seccion: 'taller',   // mismo permiso que Taller
    },
    {
      titulo: 'Solicitudes mayoristas',
      descripcion: 'Aprobar o rechazar los clientes que piden precios mayoristas',
      icono: 'fas fa-user-check',
      ruta: '/gestiones/solicitudes-mayoristas',
      seccion: 'clientes',   // mismo permiso que Clientes
    },
    {
      titulo: 'Clientes',
      descripcion: 'Gestión de clientes',
      icono: 'fas fa-users',
      ruta: '/gestiones/clientes',
    },
    {
      titulo: 'Productos',
      descripcion: 'Gestión de productos',
      icono: 'fas fa-box-open',
      ruta: '/gestiones/productos',
    },
    {
      titulo: 'Equipos',
      descripcion: 'Equipos para la venta (unidades únicas por IMEI)',
      icono: 'fas fa-mobile-alt',
      ruta: '/gestiones/equipos',
    },
    {
      titulo: 'Pedidos',
      descripcion: 'Gestión de pedidos',
      icono: 'fas fa-shopping-cart',
      ruta: '/gestiones/pedidos',
    },
    {
      titulo: 'Taller',
      descripcion: 'Gestión de services y reparaciones',
      icono: 'fas fa-microchip',
      ruta: '/gestiones/taller',
    },
    {
      titulo: 'Vouchers y membresía',
      descripcion: 'Gestión de puntos por membresía y vouchers',
      icono: 'fa-solid fa-gift',
      ruta: '/gestiones/gifts',
    },
    {
      titulo: 'Información de la Empresa',
      descripcion: 'Gestión de información de la empresa',
      icono: 'fa-solid fa-building',
      ruta: '/gestiones/empresa',
    },
    {
      titulo: 'Banner',
      descripcion: 'Gestión de banner',
      icono: 'fas fa-image',
      ruta: '/gestiones/banner',
      disabled: false, // 🚫
    },
    {
      titulo: 'Caja',
      descripcion: 'Gestión de caja',
      icono: 'fas fa-cash-register',
      ruta: '/gestiones/caja',
    },
    {
      titulo: 'Cuentas corrientes',
      descripcion: 'Deudas de los clientes mayoristas, compras y pagos',
      icono: 'fa-solid fa-book',
      ruta: '/gestiones/cuentas-corrientes',
    },
    {
      titulo: 'Créditos de la casa',
      descripcion: 'Ventas en cuotas: créditos vigentes, cuotas en tiempo o vencidas y pagos',
      icono: 'fas fa-home',
      ruta: '/gestiones/creditos',
      seccion: 'cuentas',   // mismo permiso que Cuentas corrientes
    },
    {
      titulo: 'Cajeros',
      descripcion: 'Alta y baja de las personas que cobran en despacho',
      icono: 'fas fa-user-tie',
      ruta: '/gestiones/cajeros',
    },
    {
      titulo: 'Sucursales',
      descripcion: 'Gestión de sucursales',
      icono: 'fas fa-map-marker-alt',
      ruta: '/gestiones/sucursales',
    },

     {
      titulo: 'Marquesina',
      descripcion: 'Gestión de marquesina',
      icono: 'fa-solid fa-bullhorn',
      ruta: '/gestiones/marquesina',
    },

    {
      titulo: 'Tickets',
      descripcion: 'Buscar, reimprimir y anular tickets del local',
      icono: 'fa-solid fa-receipt',
      ruta: '/gestiones/tickets',
    },

    {
      titulo: 'Auditoría',
      descripcion: 'Registro de todas las acciones de los usuarios',
      icono: 'fa-solid fa-user-shield',
      ruta: '/gestiones/auditoria',
    },
    
  ];

  /** Cards que ve el usuario según sus permisos */
  visibles: any[] = [];
  cargandoPermisos = true;

  constructor(
    private router: Router,
    private authService: AuthService,
    private permisos: PermisosService,
    private solicitudesMayoristas: SolicitudesMayoristasService
  ) { }

  /** Número rojo en la tarjeta "Solicitudes mayoristas" */
  private async contarSolicitudesPendientes() {
    const card: any = this.visibles.find(g => g.ruta === '/gestiones/solicitudes-mayoristas');
    if (!card) return;
    try {
      card.pendientes = await this.solicitudesMayoristas.cantidadPendientes();
    } catch (err) {
      console.warn('No se pudieron contar las solicitudes mayoristas', err);
    }
  }

  async ngOnInit() {
    this.sincronizarIndiceUsuarios();
    try {
      const [permisos, superAdmin] = await Promise.all([this.permisos.permisos(), this.permisos.esSuperAdmin()]);
      this.visibles = this.gestiones.filter(g => {
        const seccion = (g as any).seccion || seccionDeRuta(g.ruta);
        return superAdmin || (!!seccion && permisos.includes(seccion));
      });
      if (superAdmin) this.visibles = [...this.visibles, CARD_PERMISOS];
      this.contarSolicitudesPendientes();
    } catch (e) {
      console.error('No se pudieron verificar los permisos', e);
      this.visibles = [];
    } finally {
      this.cargandoPermisos = false;
    }
  }

  /**
   * Mantiene completo el índice 'Usuarios' (nombre de usuario → mail) que usa el login.
   * Corre una vez por sesión; solo un administrador tiene permiso para hacerlo.
   */
  private async sincronizarIndiceUsuarios() {
    const CLAVE = 'indiceUsuariosSincronizado';
    try {
      if (sessionStorage.getItem(CLAVE)) return;
    } catch { /* sin sessionStorage: seguimos igual */ }

    try {
      const { creados, duplicados } = await this.authService.sincronizarIndiceUsuarios();
      if (creados > 0) console.log(`Índice de usuarios: ${creados} usuarios agregados.`);
      if (duplicados.length) console.warn('Usuarios con nombre repetido:', duplicados);
      try { sessionStorage.setItem(CLAVE, '1'); } catch { }
    } catch (err) {
      console.error('No se pudo sincronizar el índice de usuarios:', err);
    }
  }

  irAGestion(ruta: string) {
    this.router.navigate(['/gestiones', ruta]);
  }

}
