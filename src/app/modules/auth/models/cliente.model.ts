export class Cliente {
    constructor(
        public id: string,
        public usuario: string,
        public mail: string,
        public telefono: string,
        public direccion: string,
        public historial: any[] = [],
        public estado: boolean,
        public nombre: string,
        public apellido: string,
        public administrador: boolean = false,
        public carrito: any[] = [],
        public dni: number,
        public puntos: number,
        public esMayorista: boolean = false,
        public razonSocial: string = '',
        public cuit: string = ''
    ) { }
}