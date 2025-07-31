import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ListaOrdenesComponent } from './lista-ordenes.component';

describe('ListaOrdenesComponent', () => {
  let component: ListaOrdenesComponent;
  let fixture: ComponentFixture<ListaOrdenesComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ ListaOrdenesComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ListaOrdenesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
