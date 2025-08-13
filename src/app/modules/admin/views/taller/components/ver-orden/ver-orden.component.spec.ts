import { ComponentFixture, TestBed } from '@angular/core/testing';

import { VerOrdenComponent } from './ver-orden.component';

describe('VerOrdenComponent', () => {
  let component: VerOrdenComponent;
  let fixture: ComponentFixture<VerOrdenComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ VerOrdenComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(VerOrdenComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
