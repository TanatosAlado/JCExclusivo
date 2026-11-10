import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { AuthService } from 'src/app/modules/auth/services/auth.service';

@Component({
  selector: 'app-card-categorias',
  templateUrl: './card-categorias.component.html',
  styleUrls: ['./card-categorias.component.css']
})
export class CardCategoriasComponent implements OnInit, OnDestroy {

  imagenesCategorias: string[] = [];

  /** Mayorista o minorista. Sin sesión (o invitado) se muestran las categorías minoristas. */
  private esMayorista = false;
  private sub?: Subscription;

  constructor(private router: Router, private authService: AuthService) {}

  ngOnInit() {
    // Se actualiza solo al iniciar o cerrar sesión (antes se leía una vez y,
    // sin cliente logueado, fallaba y no se mostraba ninguna categoría)
    this.sub = this.authService.getUsuarioActual().subscribe(cliente => {
      this.esMayorista = cliente?.esMayorista === true;
      this.cargarImagenesCategorias();
    });
  }

  ngOnDestroy() {
    this.sub?.unsubscribe();
  }


  //FUNCION PARA CARGAR IMAGENES DE CATEGORIAS
  cargarImagenesCategorias() {
    if (this.esMayorista) {
      this.imagenesCategorias = [
        'assets/imagenes/categorías/may_01.jpg',
        'assets/imagenes/categorías/may_02.jpg',
        'assets/imagenes/categorías/may_03.jpg',
        'assets/imagenes/categorías/may_04.jpg',
        'assets/imagenes/categorías/mas.jpg'
      ];
    } else {
      this.imagenesCategorias = [
        'assets/imagenes/categorías/min_01.jpg',
        'assets/imagenes/categorías/min_02.jpg',
        'assets/imagenes/categorías/min_03.jpg',
        'assets/imagenes/categorías/min_04.jpg',
        'assets/imagenes/categorías/min_05.jpg',
        'assets/imagenes/categorías/mas.jpg'
      ];
    }
  }

  seleccionarCategoria(imagen: string) {

    let rubro = '';

    if (this.esMayorista) {

      if (imagen.includes('may_01')) {
        rubro = 'Accesorios';
      }

      if (imagen.includes('may_02')) {
        rubro = 'Herramientas';
      }

      if (imagen.includes('may_03')) {
        rubro = 'Insumos';
      }

      if (imagen.includes('may_04')) {
        rubro = 'Repuestos';
      }

    } else {

      if (imagen.includes('min_01')) {
        rubro = 'Auriculares';
      }

      if (imagen.includes('min_02')) {
        rubro = 'Cargadores';
      }

      if (imagen.includes('min_03')) {
        rubro = 'Fundas';
      }

      if (imagen.includes('min_04')) {
        rubro = 'Baterías';
      }

      if (imagen.includes('min_05')) {
        rubro = 'Protector Pantalla';
      }

    }

    // IR AL COMPONENTE DE PRODUCTOS
    this.router.navigate(['/productos'], {
      queryParams: {
        rubro: rubro
      }
    });

  }
}
