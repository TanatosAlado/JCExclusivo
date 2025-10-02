import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AbrirCajaDialogComponent } from './abrir-caja-dialog.component';

describe('AbrirCajaDialogComponent', () => {
  let component: AbrirCajaDialogComponent;
  let fixture: ComponentFixture<AbrirCajaDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ AbrirCajaDialogComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AbrirCajaDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
