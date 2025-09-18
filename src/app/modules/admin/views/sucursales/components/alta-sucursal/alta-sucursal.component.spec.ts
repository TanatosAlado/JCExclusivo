import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AltaSucursalComponent } from './alta-sucursal.component';

describe('AltaSucursalComponent', () => {
  let component: AltaSucursalComponent;
  let fixture: ComponentFixture<AltaSucursalComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ AltaSucursalComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AltaSucursalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
