export interface StockSucursal {
  sucursalId: string;
  cantidad: number;
}

export interface VarianteProducto {
  id?: string;
  modelo?: string;
  color?: string;
  codigoBarras?: string;
  precioCosto?: number;
  precioMinorista?: number;
  precioMayorista?: number;
  stockSucursales: StockSucursal[];
  stockMayorista: number;
  imagen?: string;
}

export class Producto {
  constructor(
    public id: string,
    public codigoBarras: string, // sigue existiendo para productos sin variantes
    public descripcion: string,
    public precioCosto: number,
    public ventaMinorista: boolean,
    public precioMinorista: number,
    public ventaMayorista: boolean,
    public precioMayorista: number,
    public imagen: string,
    public rubro: string,
    public subrubro: string,
    public marca: string,
    public destacado: boolean,
    public oferta: boolean,
    public precioOferta: number,
    public precioSinImpuestos: number,
    public stockMinimo: number,
    public stockSucursales: StockSucursal[],
    public stockMayorista: number,
    public variantes?: VarianteProducto[], // 🔹 nuevas variantes unificadas
    public tipoVariantes?: 'none' | 'color' | 'modelo+color', // 🔹 control de tipo
  ) {}

  get stockTotal(): number {
    return (this.stockSucursales || []).reduce((a, b) => a + b.cantidad, 0);
  }

  get stockGlobal(): number {
    return this.stockTotal + (this.stockMayorista || 0);
  }
}



// export class Producto {
//   constructor(
//     public id: string,
//     public codigoBarras: string,
//     public descripcion: string,
//     public precioCosto: number,
//     public ventaMinorista: boolean,
//     public precioMinorista: number,
//     public ventaMayorista: boolean,
//     public precioMayorista: number,
//     public imagen: string,
//     public rubro: string,
//     public subrubro: string,
//     public marca: string,
//     public destacado: boolean,
//     public oferta: boolean,
//     public precioOferta: number,
//     public precioSinImpuestos: number,
//     public stockMinimo: number,
//     public stockSucursales: { sucursalId: string; cantidad: number }[],
//     public stockMayorista: number,
//     public color?: string,

//     // 🔹 Variantes SIN modelo (producto base)
//     public variantes?: {
//       color: string;
//       codigoBarras?: string;
//       stockSucursales: { sucursalId: string; cantidad: number }[];
//       stockMayorista: number;
//       modelo?: string;
//     }[],

//     // 🔹 Variantes CON modelo
//     public modelos?: {
//       modelo: string;
//       variantesColor: {
//         color: string;
//         codigoBarras?: string;
//         stockSucursales: { sucursalId: string; cantidad: number }[];
//         stockMayorista: number;
//       }[];
//     }[]
//   ) {}

//   get stockTotal(): number {
//     return (this.stockSucursales || []).reduce((a, b) => a + b.cantidad, 0);
//   }

//   get stockGlobal(): number {
//     return this.stockTotal + (this.stockMayorista || 0);
//   }
// }
