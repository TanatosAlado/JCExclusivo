import { StockDescontado } from "./pedido.model";

export class Carrito {
    id:string;
    nombre:string;
    imagen:string;
    cantidad:number;
    precioOferta?:number;
    porcentajeOferta?:number;
    precioFinal:number; 
    stockDescontado?: StockDescontado;
    

    constructor(id:string,imagen:string,nombre:string,cantidad:number,precioFinal:number, precioOferta:number, porcentajeOferta:number){
        this.id=id
        this.imagen=imagen
        this.nombre=nombre
        this.cantidad=cantidad
        this.precioFinal=precioFinal,
        this.precioOferta=precioOferta,
        this.porcentajeOferta=porcentajeOferta
    }
}