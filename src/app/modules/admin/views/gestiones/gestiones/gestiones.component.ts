import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from 'src/app/modules/auth/services/auth.service';

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

  constructor(private router: Router, private authService: AuthService) { }

  ngOnInit() {
    this.sincronizarIndiceUsuarios();
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
