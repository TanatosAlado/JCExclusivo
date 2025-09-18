export interface Sucursal {
  id?: string;         // ID autogenerado por Firebase
  nombre: string;      // Nombre de la sucursal
  direccion: string;   // Dirección completa
  telefono?: string;   // Teléfono de contacto
  activa: boolean;     // Estado
}