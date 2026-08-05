import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AltaMarquesinaComponent } from './alta-marquesina.component';

describe('AltaMarquesinaComponent', () => {
  let component: AltaMarquesinaComponent;
  let fixture: ComponentFixture<AltaMarquesinaComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ AltaMarquesinaComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AltaMarquesinaComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
