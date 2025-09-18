export class Producto {
  constructor(
  public id: string,
  public codigoBarras: string,
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
  public stockSucursales: { sucursalId: string; cantidad: number }[]
  ) {}

  get stockTotal(): number {
    return (this.stockSucursales || []).reduce((a, b) => a + b.cantidad, 0);
  }
}