import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Orden } from '../../../../models/orden.model';
import { OrdenesService } from 'src/app/modules/admin/services/ordenes.service'; 
import { ClientesService } from 'src/app/shared/services/clientes.service'; 
import { Timestamp } from 'firebase/firestore';

@Component({
  selector: 'app-alta-orden',
  templateUrl: './alta-orden.component.html',
  styleUrls: ['./alta-orden.component.css']
})
export class AltaOrdenComponent {


  ordenForm!: FormGroup;
  cargandoCliente = false;
  errorCliente: string | null = null;

  constructor(
    private fb: FormBuilder,
    private ordenesService: OrdenesService,
    private clientesService: ClientesService
  ) {}

  ngOnInit(): void {
    this.ordenForm = this.fb.group({
      dniCliente: [null, [Validators.required]],
      nombreCliente: ['', [Validators.required]],
      apellidoCliente: ['', [Validators.required]],
      telefonoCliente: ['', [Validators.required]],
      imei: ['', [Validators.required]],
      equipo: ['', [Validators.required]],
      motivoIngreso: ['', [Validators.required]],
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

    this.ordenesService.generarNumeroOrden().then(numero => {
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
        estado: 'pendiente',
        fechaIngreso: new Date(),
        garantia: this.ordenForm.value.garantia,
        observaciones: this.ordenForm.value.observaciones ? [this.ordenForm.value.observaciones] : []
      };

      this.ordenesService.crearOrden(nuevaOrden).then(() => {
        // Podés mostrar un mensaje, resetear el form, etc.
        this.ordenForm.reset();
        alert('Orden creada con éxito');
      });
    });
  }
}
