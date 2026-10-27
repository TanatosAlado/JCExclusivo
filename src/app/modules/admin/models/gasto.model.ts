export interface Gasto {
  id?: string;
  fecha: Date;           // día al que corresponde el gasto
  concepto: string;      // ej: "Luz", "Sueldo", "Mercadería"
  monto: number;         // monto total
  observacion?: string;  // opcional

  // Trazabilidad (se completan solos)
  usuario?: { uid: string; usuario: string; nombre: string } | null;
  anulado?: boolean;
  motivoAnulacion?: string;
  anuladoPor?: { uid: string; usuario: string; nombre: string } | null;
}
