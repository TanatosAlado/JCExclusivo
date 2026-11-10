export interface InfoEmpresa {
  whatsapp?: string;
  cvu?: string;
  alias?: string;
  email?: string;
  dolar?: number;
  /** Dólar JC: cotización para los EQUIPOS (generalmente un poco más alta). Si no está, se usa "dolar". */
  dolarJC?: number;
  descuentoEnEfectivo?: number;
  descuentoEnTransferencia?: number;
  // Se pueden agregar mas campos.
}