import { Component } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  selector: 'app-card-categorias',
  templateUrl: './card-categorias.component.html',
  styleUrls: ['./card-categorias.component.css']
})
export class CardCategoriasComponent {

  imagenesCategorias: string[] = [];

  constructor(private router: Router) {}

  ngOnInit() { 
    this.cargarImagenesCategorias();
  }


  //FUNCION PARA CARGAR IMAGENES DE CATEGORIAS
  cargarImagenesCategorias() {
     const tipoCliente = localStorage.getItem('clienteActual');
     const cliente=JSON.parse(tipoCliente);
    if (cliente.esMayorista === true) {
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

  const tipoCliente = localStorage.getItem('clienteActual');
  const cliente = JSON.parse(tipoCliente);

  let rubro = '';

  if (cliente.esMayorista === true) {

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
