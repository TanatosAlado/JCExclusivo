export interface InfoEmpresa {
  whatsapp?: string;
  cvu?: string;
  /** Alias viejo (único). Se mantiene igual al mayorista para lo que todavía lo lea. */
  alias?: string;
  /** 💳 Alias para los minoristas e invitados (checkout de la tienda) */
  aliasMinorista?: string;
  /** Alias para los mayoristas */
  aliasMayorista?: string;
  /** 💳 Cuenta minorista: CVU/CBU, titular (nombre y apellido) y DNI, para que el cliente verifique a quién transfiere */
  cvuMinorista?: string;
  titularMinorista?: string;
  dniMinorista?: string;
  /** Cuenta mayorista (el "cvu" viejo queda igual a este) */
  cvuMayorista?: string;
  titularMayorista?: string;
  dniMayorista?: string;
  email?: string;
  dolar?: number;
  /** Dólar JC: cotización para los EQUIPOS (generalmente un poco más alta). Si no está, se usa "dolar". */
  dolarJC?: number;
  descuentoEnEfectivo?: number;
  descuentoEnTransferencia?: number;
  // Se pueden agregar mas campos.
}