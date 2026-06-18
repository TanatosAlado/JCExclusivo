import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MarquesinaComponent } from './marquesina.component';

describe('MarquesinaComponent', () => {
  let component: MarquesinaComponent;
  let fixture: ComponentFixture<MarquesinaComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ MarquesinaComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(MarquesinaComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
