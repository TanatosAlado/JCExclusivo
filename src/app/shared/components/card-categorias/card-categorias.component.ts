import { Component } from '@angular/core';

@Component({
  selector: 'app-card-categorias',
  templateUrl: './card-categorias.component.html',
  styleUrls: ['./card-categorias.component.css']
})
export class CardCategoriasComponent {

  imagenesCategorias: string[] = [];

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
      'assets/imagenes/categorías/mas.jpg'
    ];
  } else {
    this.imagenesCategorias = [
      'assets/imagenes/categorías/min_01.jpg',
      'assets/imagenes/categorías/min_02.jpg',
      'assets/imagenes/categorías/min_03.jpg',
      'assets/imagenes/categorías/mas.jpg'
    ];
  }
  }
}
