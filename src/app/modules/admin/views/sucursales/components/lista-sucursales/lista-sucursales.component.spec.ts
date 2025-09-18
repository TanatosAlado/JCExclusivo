import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ListaSucursalesComponent } from './lista-sucursales.component';

describe('ListaSucursalesComponent', () => {
  let component: ListaSucursalesComponent;
  let fixture: ComponentFixture<ListaSucursalesComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ ListaSucursalesComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ListaSucursalesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
