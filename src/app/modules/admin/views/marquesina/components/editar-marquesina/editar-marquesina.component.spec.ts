import { ComponentFixture, TestBed } from '@angular/core/testing';

import { EditarMarquesinaComponent } from './editar-marquesina.component';

describe('EditarMarquesinaComponent', () => {
  let component: EditarMarquesinaComponent;
  let fixture: ComponentFixture<EditarMarquesinaComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ EditarMarquesinaComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(EditarMarquesinaComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
