import { Carrito } from "../models/carrito.model";

export class Pedido {
    id: string;
    nroPedido:number
    fecha: string;
    user: string;
    mail: string;
    telefono: number;
    entrega:string;
    pago:string;
    domicilioEntrega:string;
    carrito: Carrito[] = [];
    total:number;
    estado: string;
    nombreCliente: string;
    apellidoCliente: string;
  
    constructor(id: string, nroPedido:number, user: string, mail: string, telefono: number,entrega:string,pago:string,fecha:string, domicilioEntrega:string, carrito: Carrito[],total:number,  estado: 'Pendiente', nombre: string, apellido: string) {
      this.id = id;
      this.nroPedido=nroPedido
      this.fecha = fecha;
      this.user = user;
      this.mail = mail;
      this.telefono = telefono;
      this.entrega=entrega;
      this.domicilioEntrega=domicilioEntrega
      this.pago=pago
      this.carrito = carrito;
      this.total=total;
      this.estado = estado;
      this.nombreCliente = nombre;
      this.apellidoCliente = apellido;
    }
  }