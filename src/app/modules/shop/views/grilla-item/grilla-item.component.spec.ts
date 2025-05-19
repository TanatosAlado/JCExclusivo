import { ComponentFixture, TestBed } from '@angular/core/testing';

import { GrillaItemComponent } from './grilla-item.component';

describe('GrillaItemComponent', () => {
  let component: GrillaItemComponent;
  let fixture: ComponentFixture<GrillaItemComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ GrillaItemComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(GrillaItemComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
