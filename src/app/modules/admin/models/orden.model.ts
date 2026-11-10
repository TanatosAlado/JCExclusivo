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
  /** Presupuesto = manoObra + repuestos. Las órdenes viejas no los tienen (null = sin discriminar) */
  manoObra?: number | null;
  repuestos?: number | null;
  /** El taller terminó el trabajo y cargó su costo (ver despacho/services/cuenta-taller.ts) */
  trabajoTerminado?: any;
  estado: string;
  fechaIngreso: Date;
  fechaEntrega?: Date;
  diasGarantia?: number;
  garantia: boolean;
  fechaGarantia?: Date;
  observaciones?: string[];
}