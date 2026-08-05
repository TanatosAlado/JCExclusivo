import { ComponentFixture, TestBed } from '@angular/core/testing';

import { VerMarquesinaComponent } from './ver-marquesina.component';

describe('VerMarquesinaComponent', () => {
  let component: VerMarquesinaComponent;
  let fixture: ComponentFixture<VerMarquesinaComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ VerMarquesinaComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(VerMarquesinaComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
