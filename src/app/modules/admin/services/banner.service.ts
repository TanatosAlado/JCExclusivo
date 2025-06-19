import { Injectable } from '@angular/core';
import { Storage, deleteObject, getDownloadURL, listAll, ref, uploadBytes } from '@angular/fire/storage';

@Injectable({
  providedIn: 'root'
})
export class BannerService {

  constructor(private storage: Storage) {}


  async uploadFile(file: File, path: string): Promise<string> {
    const fileRef = ref(this.storage, path);
    await uploadBytes(fileRef, file);
    return await getDownloadURL(fileRef);
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
  }



}
