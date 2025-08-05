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
  motivoIngreso: string;
  presupuesto: number;
  estado: string;
  fechaIngreso: Date;
  fechaEntrega?: Date;
  garantia: boolean;
  fechaGarantia?: Date;
  observaciones?: string[]; //Se puede separar en Fecha + Texto o hacerlo un string
}