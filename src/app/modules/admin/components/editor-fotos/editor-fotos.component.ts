import { Component, EventEmitter, Input, Output } from '@angular/core';
import { Storage, ref, uploadBytes, getDownloadURL } from '@angular/fire/storage';
import Swal from 'sweetalert2';
import { MAX_FOTOS, unicas } from 'src/app/shared/utils/fotos';

/**
 * Editor de fotos (varias): subir una o varias, ordenar, elegir la principal (la primera),
 * quitar o pegar una URL. Se usa en el alta y la edición de productos.
 *
 *   <app-editor-fotos [(fotos)]="fotos" carpeta="productos" (subiendo)="subiendo = $event"></app-editor-fotos>
 */
@Component({
  selector: 'app-editor-fotos',
  templateUrl: './editor-fotos.component.html',
  styleUrls: ['./editor-fotos.component.css']
})
export class EditorFotosComponent {

  @Input() fotos: string[] = [];
  @Output() fotosChange = new EventEmitter<string[]>();
  /** Carpeta de Storage (las reglas de Storage dan permiso por carpeta) */
  @Input() carpeta = 'productos';
  @Input() max = MAX_FOTOS;
  @Input() deshabilitado = false;
  /** Avisa mientras se suben fotos (para no dejar guardar a medias) */
  @Output() subiendo = new EventEmitter<boolean>();

  seleccionada = 0;
  subiendoFotos = false;
  mostrarUrl = false;
  url = '';

  constructor(private storage: Storage) { }

  get lista(): string[] {
    return Array.isArray(this.fotos) ? this.fotos : [];
  }

  get grande(): string {
    return this.lista[this.seleccionada] || this.lista[0] || '';
  }

  get lleno(): boolean {
    return this.lista.length >= this.max;
  }

  private emitir(fotos: string[], seleccionada = this.seleccionada) {
    this.fotos = unicas(fotos).slice(0, this.max);
    this.seleccionada = Math.min(Math.max(0, seleccionada), Math.max(0, this.fotos.length - 1));
    this.fotosChange.emit(this.fotos);
  }

  async alElegir(event: Event) {
    const input = event.target as HTMLInputElement;
    const archivos = Array.from(input?.files || []);
    if (input) input.value = '';
    if (!archivos.length) return;

    const lugar = this.max - this.lista.length;
    if (lugar <= 0) {
      Swal.fire('Máximo de fotos', `Se pueden cargar hasta ${this.max} fotos.`, 'info');
      return;
    }
    const aSubir = archivos.slice(0, lugar);
    this.subiendoFotos = true;
    this.subiendo.emit(true);
    try {
      for (const file of aSubir) {
        if (!file.type?.startsWith('image/')) throw new Error(`"${file.name}" no es una imagen.`);
        if (file.size > 10 * 1024 * 1024) throw new Error(`"${file.name}" pesa más de 10 MB.`);
        const nombre = file.name.replace(/[^\w.\-]+/g, '_').slice(-60);
        const archivoRef = ref(this.storage, `${this.carpeta}/${Date.now()}_${nombre}`);
        await uploadBytes(archivoRef, file);
        const url = await getDownloadURL(archivoRef);
        this.emitir([...this.lista, url], this.lista.length);
      }
      if (archivos.length > aSubir.length) {
        Swal.fire('Máximo de fotos', `Se subieron ${aSubir.length}: se pueden cargar hasta ${this.max} fotos.`, 'info');
      }
    } catch (e: any) {
      console.error('Error subiendo foto', e);
      Swal.fire('No se pudo subir la foto',
        e?.code === 'storage/unauthorized' ? 'No tenés permiso para subir fotos.' : (e?.message || 'Probá de nuevo.'), 'error');
    } finally {
      this.subiendoFotos = false;
      this.subiendo.emit(false);
    }
  }

  agregarUrl() {
    const url = (this.url || '').trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) {
      Swal.fire('URL inválida', 'Tiene que empezar con http:// o https://', 'warning');
      return;
    }
    if (this.lleno) {
      Swal.fire('Máximo de fotos', `Se pueden cargar hasta ${this.max} fotos.`, 'info');
      return;
    }
    this.emitir([...this.lista, url], this.lista.length);
    this.url = '';
    this.mostrarUrl = false;
  }

  quitar(i: number) {
    const fotos = [...this.lista];
    fotos.splice(i, 1);
    this.emitir(fotos, Math.min(this.seleccionada, fotos.length - 1));
  }

  /** La pasa a primer lugar: es la que se ve primero en la tienda */
  hacerPrincipal(i: number) {
    if (i <= 0) return;
    const fotos = [...this.lista];
    const [foto] = fotos.splice(i, 1);
    fotos.unshift(foto);
    this.emitir(fotos, 0);
  }

  mover(i: number, dir: number) {
    const j = i + dir;
    if (j < 0 || j >= this.lista.length) return;
    const fotos = [...this.lista];
    [fotos[i], fotos[j]] = [fotos[j], fotos[i]];
    this.emitir(fotos, j);
  }
}
