import { TestBed } from '@angular/core/testing';

import { EcommerceStateService } from './ecommerce-state.service';

describe('EcommerceStateService', () => {
  let service: EcommerceStateService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(EcommerceStateService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
