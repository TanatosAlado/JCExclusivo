export interface Cupon {
    id: string; // ID del cupón, se asigna automáticamente por Firestore
  codigo: string;                 // Código que se ingresa al aplicar
  tipo: 'porcentaje' | 'monto';  // Tipo de descuento
  valor: number;                 // Valor numérico (ej: 20 si es 20% o $20)
  cantidadDisponible: number;    // Cuántas veces se puede usar
  activo: boolean;               // Para desactivar sin borrar
}