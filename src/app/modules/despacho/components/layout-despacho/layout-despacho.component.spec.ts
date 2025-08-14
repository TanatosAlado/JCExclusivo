import { ComponentFixture, TestBed } from '@angular/core/testing';

import { LayoutDespachoComponent } from './layout-despacho.component';

describe('LayoutDespachoComponent', () => {
  let component: LayoutDespachoComponent;
  let fixture: ComponentFixture<LayoutDespachoComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ LayoutDespachoComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(LayoutDespachoComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
