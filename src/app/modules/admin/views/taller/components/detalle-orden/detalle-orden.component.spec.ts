import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DetalleOrdenComponent } from './detalle-orden.component';

describe('DetalleOrdenComponent', () => {
  let component: DetalleOrdenComponent;
  let fixture: ComponentFixture<DetalleOrdenComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ DetalleOrdenComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(DetalleOrdenComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
