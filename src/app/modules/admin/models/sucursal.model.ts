export interface Sucursal {
  id?: string;         // ID autogenerado por Firebase
  nombre: string;      // Nombre de la sucursal
  direccion: string;   // Dirección completa
  telefono?: string;   // Teléfono de contacto
  activa: boolean;     // Estado
  /**
   * Aparece en la tienda online para "Retiro en sucursal".
   * Las sucursales internas (ej: el mayorista / taller) lo tienen en false.
   * Sin cargar = true (las sucursales de antes siguen apareciendo).
   */
  retiroWeb?: boolean;
}

/** ¿Se ofrece para retirar pedidos de la tienda online? (activa y con retiro habilitado) */
export function disponibleParaRetiro(s: Partial<Sucursal> | null | undefined): boolean {
  return !!s && s.activa !== false && s.retiroWeb !== false;
}