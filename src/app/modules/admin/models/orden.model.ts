export interface Orden {
  id: string;
  numeroOrden: number;
  imei: string;
  equipo: string;
  idCliente?: string;
  nombreCliente: string;
  telefonoCliente: string;
  apellidoCliente: string;
  dniCliente: number;
  esGremio: boolean;
  gremioNombre?: string; // opcional
  motivoIngreso: string;
  codigoDesbloqueo: string;
  colorEquipo: string;
  presupuesto: number;
  estado: string;
  fechaIngreso: Date;
  fechaEntrega?: Date;
  diasGarantia?: number;
  garantia: boolean;
  fechaGarantia?: Date;
  observaciones?: string[];
}