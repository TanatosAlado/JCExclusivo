import { ComponentFixture, TestBed } from '@angular/core/testing';

import { EstiloMarquesinaComponent } from './estilo-marquesina.component';

describe('EstiloMarquesinaComponent', () => {
  let component: EstiloMarquesinaComponent;
  let fixture: ComponentFixture<EstiloMarquesinaComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ EstiloMarquesinaComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(EstiloMarquesinaComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
