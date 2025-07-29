import { TestBed } from '@angular/core/testing';

import { VouchersPuntosService } from './vouchers-puntos.service';

describe('VouchersPuntosService', () => {
  let service: VouchersPuntosService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(VouchersPuntosService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
