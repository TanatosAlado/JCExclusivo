import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ComprobanteOrdenComponent } from './comprobante-orden.component';

describe('ComprobanteOrdenComponent', () => {
  let component: ComprobanteOrdenComponent;
  let fixture: ComponentFixture<ComprobanteOrdenComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ ComprobanteOrdenComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ComprobanteOrdenComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
