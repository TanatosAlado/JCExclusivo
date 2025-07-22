import { TestBed } from '@angular/core/testing';

import { InfoEmpresaService } from './info-empresa.service';

describe('InfoEmpresaService', () => {
  let service: InfoEmpresaService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(InfoEmpresaService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
