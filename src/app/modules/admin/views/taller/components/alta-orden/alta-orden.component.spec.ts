import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AltaOrdenComponent } from './alta-orden.component';

describe('AltaOrdenComponent', () => {
  let component: AltaOrdenComponent;
  let fixture: ComponentFixture<AltaOrdenComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ AltaOrdenComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AltaOrdenComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
