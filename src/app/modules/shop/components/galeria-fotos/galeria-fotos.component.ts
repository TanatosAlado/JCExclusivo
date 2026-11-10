import { AfterViewInit, Component, ElementRef, EventEmitter, HostListener, Input, OnDestroy, OnInit, Output, ViewChild } from '@angular/core';

/**
 * Galería de fotos en grande (pantalla completa) para la tienda.
 * Se muestra con *ngIf desde el componente que la usa:
 *
 *   <app-galeria-fotos *ngIf="verGaleria" [fotos]="fotos" [(indice)]="indiceFoto"
 *     [titulo]="producto.descripcion" (cerrar)="verGaleria = false"></app-galeria-fotos>
 *
 * Flechas del teclado para pasar fotos y Escape para cerrar.
 * La capa se pasa al <body> para que ningún "transform" de la tarjeta la recorte.
 */
@Component({
  selector: 'app-galeria-fotos',
  templateUrl: './galeria-fotos.component.html',
  styleUrls: ['./galeria-fotos.component.css']
})
export class GaleriaFotosComponent implements OnInit, AfterViewInit, OnDestroy {

  @ViewChild('capa') capa?: ElementRef<HTMLElement>;

  @Input() fotos: string[] = [];
  @Input() titulo = '';
  @Input() indice = 0;
  @Output() indiceChange = new EventEmitter<number>();
  @Output() cerrar = new EventEmitter<void>();

  ngOnInit(): void {
    document.body.style.overflow = 'hidden';
  }

  ngAfterViewInit(): void {
    const el = this.capa?.nativeElement;
    if (el) document.body.appendChild(el);
  }

  ngOnDestroy(): void {
    this.capa?.nativeElement?.remove();
    document.body.style.removeProperty('overflow');
  }

  get lista(): string[] {
    return Array.isArray(this.fotos) ? this.fotos : [];
  }

  get actual(): string {
    return this.lista[this.indice] || this.lista[0] || '';
  }

  cambiar(dir: number, evento?: Event) {
    evento?.stopPropagation();
    const n = this.lista.length;
    if (n < 2) return;
    this.ir((this.indice + dir + n) % n);
  }

  ir(i: number, evento?: Event) {
    evento?.stopPropagation();
    this.indice = i;
    this.indiceChange.emit(i);
  }

  @HostListener('document:keydown', ['$event'])
  teclado(e: KeyboardEvent) {
    if (e.key === 'Escape') this.cerrar.emit();
    else if (e.key === 'ArrowRight') this.cambiar(1);
    else if (e.key === 'ArrowLeft') this.cambiar(-1);
  }
}
