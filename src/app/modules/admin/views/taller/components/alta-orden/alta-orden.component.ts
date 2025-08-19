import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Orden } from '../../../../models/orden.model';
import { OrdenesService } from 'src/app/modules/admin/services/ordenes.service';
import { ClientesService } from 'src/app/shared/services/clientes.service';
import { ToastService } from 'src/app/shared/services/toast.service';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { ComprobanteOrdenComponent } from '../comprobante-orden/comprobante-orden.component';

@Component({
  selector: 'app-alta-orden',
  templateUrl: './alta-orden.component.html',
  styleUrls: ['./alta-orden.component.css']
})
export class AltaOrdenComponent {


  ordenForm!: FormGroup;
  cargandoCliente = false;
  errorCliente: string | null = null;
  cargando = false;

  constructor(
    private fb: FormBuilder,
    private ordenesService: OrdenesService,
    private clientesService: ClientesService,
    private toastService: ToastService,
    private dialog: MatDialog,
    private dialogRef: MatDialogRef<AltaOrdenComponent>

  ) { }

  ngOnInit(): void {
    this.ordenForm = this.fb.group({
      dniCliente: [null, [Validators.required]],
      nombreCliente: ['', [Validators.required]],
      apellidoCliente: ['', [Validators.required]],
      telefonoCliente: ['', [Validators.required]],
      imei: ['', [Validators.required]],
      equipo: ['', [Validators.required]],
      motivoIngreso: ['', [Validators.required]],
      codigoDesbloqueo: [''],
      colorEquipo: [''],
      presupuesto: [0],
      garantia: [false],
      observaciones: ['']
    });
  }

  buscarCliente(): void {
    const dni = this.ordenForm.get('dniCliente')?.value;
    if (!dni) return;

    this.cargandoCliente = true;
    this.errorCliente = null;

    this.clientesService.buscarPorDni(dni).then(cliente => {
      if (cliente) {
        this.ordenForm.patchValue({
          nombreCliente: cliente.nombre,
          apellidoCliente: cliente.apellido,
          telefonoCliente: cliente.telefono
        });
      } else {
        console.error('Cliente no encontrado');
        this.errorCliente = 'Cliente no encontrado';
      }
    }).catch(err => {
      console.error('Error buscando cliente:', err);
      this.errorCliente = 'Error en la búsqueda';
    }).finally(() => {
      this.cargandoCliente = false;
    });
  }

  onSubmit(): void {
    if (this.ordenForm.invalid) return;

    this.cargando = true;

    this.ordenesService.generarNumeroOrden().then(numero => {
      const fechaActual = new Date();
      const dia = String(fechaActual.getDate()).padStart(2, '0');
      const mes = String(fechaActual.getMonth() + 1).padStart(2, '0');
      const anio = fechaActual.getFullYear();
      const fechaFormateada = `${dia}/${mes}/${anio}`;

      const nuevaOrden: Omit<Orden, 'id'> = {
        numeroOrden: numero,
        dniCliente: this.ordenForm.value.dniCliente,
        nombreCliente: this.ordenForm.value.nombreCliente,
        apellidoCliente: this.ordenForm.value.apellidoCliente,
        telefonoCliente: this.ordenForm.value.telefonoCliente,
        imei: this.ordenForm.value.imei,
        equipo: this.ordenForm.value.equipo,
        motivoIngreso: this.ordenForm.value.motivoIngreso,
        presupuesto: this.ordenForm.value.presupuesto,
        codigoDesbloqueo: this.ordenForm.value.codigoDesbloqueo,
        colorEquipo: this.ordenForm.value.colorEquipo,
        estado: 'Pendiente',
        fechaIngreso: new Date(),
        garantia: this.ordenForm.value.garantia,
        observaciones: Array.isArray(this.ordenForm.value.observaciones)
          ? this.ordenForm.value.observaciones
          : this.ordenForm.value.observaciones
            ? [`${fechaFormateada}: ${this.ordenForm.value.observaciones}`]
            : []
      };

      this.ordenesService.crearOrden(nuevaOrden).then((ordenCreada) => {
        this.ordenForm.reset();
        this.toastService.toastMessage("Orden Creada con éxito", 'green', 2000);

        this.dialogRef.close(ordenCreada);

        this.dialog.open(ComprobanteOrdenComponent, {
          width: '600px',
          data: ordenCreada
        });
      }).finally(() => {
        this.cargando = false; // oculta el spinner
      });

    }).catch(() => {
      this.cargando = false;
    });
  }

  cancelar(): void {
    this.dialogRef.close(); // Cierra el modal sin devolver datos
  }


}
