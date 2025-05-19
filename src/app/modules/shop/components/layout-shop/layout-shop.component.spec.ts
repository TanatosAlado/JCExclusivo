import { ComponentFixture, TestBed } from '@angular/core/testing';

import { LayoutShopComponent } from './layout-shop.component';

describe('LayoutShopComponent', () => {
  let component: LayoutShopComponent;
  let fixture: ComponentFixture<LayoutShopComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ LayoutShopComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(LayoutShopComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
