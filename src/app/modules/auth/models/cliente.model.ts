import { SolicitudMayorista } from 'src/app/shared/utils/solicitud-mayorista';

export class Cliente {
    /** Superadministrador: accede a las secciones exclusivas. Se asigna solo desde la consola de Firebase. */
    superAdmin?: boolean;
    /** Dueño: superadmin que nadie puede modificar desde la app. Se marca solo desde la consola de Firebase. */
    dueno?: boolean;
    /** Secciones del panel habilitadas (ver core/secciones.ts). Sin cargar = permisos por defecto. */
    permisos?: string[];
    /** Pedido para ser mayorista (lo aprueba o rechaza un administrador en Gestiones) */
    solicitudMayorista?: SolicitudMayorista;

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
        public mayoristaActivado: boolean = false
    ) { }
}