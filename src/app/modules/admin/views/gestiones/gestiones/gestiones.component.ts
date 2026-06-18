import { Component } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  selector: 'app-gestiones',
  templateUrl: './gestiones.component.html',
  styleUrls: ['./gestiones.component.css']
})
export class GestionesComponent {

  gestiones = [
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
    
  ];

  constructor(private router: Router) { }

  irAGestion(ruta: string) {
    this.router.navigate(['/gestiones', ruta]);
  }

}
