export interface Gasto {
  id?: string;              
  fecha: Date;              
  monto: number;            
  descripcion: string;      
  categoria?: string;       // ej: servicios, sueldos, impuestos
  metodoPago?: string;      // ej: efectivo, transferencia, tarjeta
}