import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ConsultaOrdenComponent } from './consulta-orden.component';

describe('ConsultaOrdenComponent', () => {
  let component: ConsultaOrdenComponent;
  let fixture: ComponentFixture<ConsultaOrdenComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ ConsultaOrdenComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ConsultaOrdenComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
