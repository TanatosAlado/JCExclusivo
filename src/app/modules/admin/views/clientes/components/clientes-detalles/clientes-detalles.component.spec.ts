import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ClientesDetallesComponent } from './clientes-detalles.component';

describe('ClientesDetallesComponent', () => {
  let component: ClientesDetallesComponent;
  let fixture: ComponentFixture<ClientesDetallesComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ ClientesDetallesComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ClientesDetallesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
