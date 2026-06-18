import { TestBed } from '@angular/core/testing';

import { MarquesinaService } from './marquesina.service';

describe('MarquesinaService', () => {
  let service: MarquesinaService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(MarquesinaService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
