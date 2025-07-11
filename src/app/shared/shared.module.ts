import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavbarComponent } from './components/navbar/navbar.component';
import { FooterComponent } from './components/footer/footer.component';
import { DashboardComponent } from './components/dashboard/dashboard.component';
import { MatIconModule } from '@angular/material/icon';
import { MatDialogModule } from '@angular/material/dialog';
import { RouterModule } from '@angular/router';
import { MatGridListModule } from '@angular/material/grid-list';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button'; 
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule } from '@angular/material/paginator';
import { ReactiveFormsModule, FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatDividerModule } from '@angular/material/divider';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatBadgeModule } from '@angular/material/badge';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { CarritoComponent } from './components/carrito/carrito.component';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { ConfirmDialogComponent } from './components/confirm-dialog/confirm-dialog.component';


@NgModule({
  declarations: [
    NavbarComponent,
    FooterComponent,
    DashboardComponent,
    CarritoComponent,
    ConfirmDialogComponent
  ],
  imports: [
    CommonModule,
    MatIconModule,
    MatDialogModule,
    RouterModule,
    MatGridListModule,
    MatCardModule,
    MatButtonModule,
    MatTableModule,
    MatPaginatorModule,
    ReactiveFormsModule,
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatCheckboxModule,
    MatSlideToggleModule,
    MatDividerModule,
    MatSnackBarModule,
    MatTooltipModule,
    MatBadgeModule,
    MatAutocompleteModule,
    MatButtonToggleModule
  ],
  exports: [
    NavbarComponent,
    FooterComponent,
    DashboardComponent,
    MatIconModule,
    MatDialogModule,
    RouterModule,
    MatGridListModule,
    MatCardModule,
    MatButtonModule,
    MatTableModule,
    MatPaginatorModule,
    ReactiveFormsModule,
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatCheckboxModule,
    MatSlideToggleModule,
    MatDividerModule,
    MatSnackBarModule,
    MatTooltipModule,
    MatBadgeModule,
    MatAutocompleteModule,
    MatButtonToggleModule
  ]
})
export class SharedModule { }
