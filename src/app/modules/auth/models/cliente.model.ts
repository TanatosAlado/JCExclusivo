export class Cliente {
    constructor(
        public administrador: boolean = false,
        public apellido: string,
        public carrito: any[] = [],
        public cuit: string = '',
        public direccion: string,
        public dni: number,
        public esMayorista: boolean = false,
        public estado: boolean,
        public historial: any[] = [],
        public id: string,
        public mail: string,
        public nombre: string,
        public puntos: number,
        public razonSocial: string = '',
        public telefono: string,
        public usuario: string,
    ) { }
}