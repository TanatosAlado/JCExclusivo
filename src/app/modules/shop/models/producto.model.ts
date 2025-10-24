export class Producto {
  constructor(
    public id: string,
    public codigoBarras: string,
    public descripcion: string,
    public precioCosto: number,

    // 🛒 Minorista
    public ventaMinorista: boolean,
    public precioMinorista: number,

    // 🏷️ Mayorista
    public ventaMayorista: boolean,
    public precioMayorista: number,

    // 📸 Imagen principal
    public imagen: string,

    // 🧩 Clasificación
    public rubro: string,
    public subrubro: string,
    public marca: string,

    // ⭐ Promociones
    public destacado: boolean,
    public oferta: boolean,
    public precioOferta: number,
    public precioSinImpuestos: number,

    // 📦 Stock
    public stockMinimo: number,
    public stockSucursales: { sucursalId: string; cantidad: number }[],
    public stockMayorista: number,

    // 🎨 Campos opcionales
    public color?: string, // ✅ ahora al final
    public variantes?: {
      color?: string;
      codigoBarras?: string;
      stockSucursales: { sucursalId: string; cantidad: number }[];
      stockMayorista: number;
    }[]
  ) {}

  // 📊 Stock total en sucursales
  get stockTotal(): number {
    return (this.stockSucursales || []).reduce((a, b) => a + b.cantidad, 0);
  }

  // 📦 Stock global incluyendo mayorista
  get stockGlobal(): number {
    return this.stockTotal + (this.stockMayorista || 0);
  }
}