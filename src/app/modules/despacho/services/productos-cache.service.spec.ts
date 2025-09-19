import { TestBed } from '@angular/core/testing';

import { ProductosCacheService } from './productos-cache.service';

describe('ProductosCacheService', () => {
  let service: ProductosCacheService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ProductosCacheService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
