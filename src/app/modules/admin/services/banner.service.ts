import { Injectable } from '@angular/core';
import { Storage, deleteObject, getDownloadURL, listAll, ref, uploadBytes } from '@angular/fire/storage';
import { AuditoriaService } from 'src/app/shared/services/auditoria.service';

@Injectable({
  providedIn: 'root'
})
export class BannerService {

  constructor(private storage: Storage, private auditoria: AuditoriaService) {}


  async uploadFile(file: File, path: string): Promise<string> {
    const fileRef = ref(this.storage, path);
    await uploadBytes(fileRef, file);
    const url = await getDownloadURL(fileRef);
    this.auditoria.registrar({
      accion: 'crear', entidad: 'Imagenes', entidadId: path.replace(/\//g, '_'),
      descripcion: `Subió la imagen "${path}"`
    });
    return url;
  }

  async listarArchivos(carpeta: string): Promise<{ nombre: string, url: string }[]> {
    const carpetaRef = ref(this.storage, carpeta);
    const result = await listAll(carpetaRef);
    const archivos = await Promise.all(result.items.map(async (item) => {
      const url = await getDownloadURL(item);
      return { nombre: item.name, url };
    }));
    return archivos;
  }

  async eliminarArchivo(path: string): Promise<void> {
    const archivoRef = ref(this.storage, path);
    await deleteObject(archivoRef);
    this.auditoria.registrar({
      accion: 'eliminar', entidad: 'Imagenes', entidadId: path.replace(/\//g, '_'),
      descripcion: `Eliminó la imagen "${path}"`
    });
  }



}
