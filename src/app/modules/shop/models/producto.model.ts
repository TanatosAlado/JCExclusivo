export interface VarianteProducto {
  nombre: string;
  stock: number;
  valor: string;
}

export class Producto {
  constructor(
    public id: string,
    public codigo: string,  //Agregado para el codigo del producto (codigo de barras)
    public nombre: string,
    public descripcion: string,
    public precioCosto: number,       //Agregado para el costo del producto
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
    public tieneVariantes: boolean,
    public stock: number,
    public stockMinimo: number, //Agregado para el stock minimo
    public variantes: VarianteProducto[]
  )
  { }
}
