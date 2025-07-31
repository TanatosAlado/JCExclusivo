import { ComponentFixture, TestBed } from '@angular/core/testing';

import { EdicionOrdenComponent } from './edicion-orden.component';

describe('EdicionOrdenComponent', () => {
  let component: EdicionOrdenComponent;
  let fixture: ComponentFixture<EdicionOrdenComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ EdicionOrdenComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(EdicionOrdenComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
