import { Component, OnInit, ViewChild } from '@angular/core';
import { MatPaginator } from '@angular/material/paginator';
import { MatTableDataSource } from '@angular/material/table';
import { Sucursal } from 'src/app/modules/admin/models/sucursal.model';
import { AltaSucursalComponent } from '../alta-sucursal/alta-sucursal.component';
import { MatDialog } from '@angular/material/dialog';
import { SucursalesService } from 'src/app/modules/admin/services/sucursales.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { DetalleSucursalComponent } from '../detalle-sucursal/detalle-sucursal.component';


@Component({
  selector: 'app-lista-sucursales',
  templateUrl: './lista-sucursales.component.html',
  styleUrls: ['./lista-sucursales.component.css']
})
export class ListaSucursalesComponent {
  displayedColumns: string[] = ['nombre', 'direccion', 'telefono', 'activa', 'acciones'];
  datasourceSucursales = new MatTableDataSource<Sucursal>([]);

  @ViewChild(MatPaginator) paginator!: MatPaginator;

  constructor(public dialog: MatDialog, private sucursalesService: SucursalesService, private snackBar: MatSnackBar) {}

  ngOnInit(): void {
    this.cargarSucursales();
  }

  cargarSucursales() {
    this.sucursalesService.obtenerSucursales().subscribe(sucursales => {
      this.datasourceSucursales.data = sucursales;
      this.datasourceSucursales.paginator = this.paginator;
    });
  }

  abrirModalAltaSucursal() {
      const dialogRef = this.dialog.open(AltaSucursalComponent, {
        width: '90vw',
        maxWidth: '600px',
        height: 'auto',
        maxHeight: '90vh',
        data: {} // sin datos => alta
      });
    
      dialogRef.afterClosed().subscribe(resultado => {
        if (resultado) {
          console.log('Sucursal creada:', resultado);
        }
      });
  }

  verSucursal(sucursal: Sucursal) {
    this.dialog.open(DetalleSucursalComponent, {
      width: '90vw',
      maxWidth: '500px',
      data: { sucursal }
    });
  }

  async editarSucursal(sucursal: Sucursal) {
    const dialogRef = this.dialog.open(AltaSucursalComponent, {
      width: '90vw',
      maxWidth: '600px',
      height: 'auto',
      maxHeight: '90vh',
      data: { sucursal } // paso la sucursal para edición
    });

    dialogRef.afterClosed().subscribe(resultado => {
      if (resultado) {
        this.snackBar.open('Sucursal actualizada correctamente ✅', 'Cerrar', { duration: 3000 });
        this.cargarSucursales();
      }
    });
  }

  async openConfirmDialog(sucursal: Sucursal) {
    if (confirm(`¿Seguro que deseas eliminar la sucursal "${sucursal.nombre}"?`)) {
      await this.sucursalesService.eliminarSucursal(sucursal.id!);
    }
  }


}

