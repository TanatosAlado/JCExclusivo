import { Component } from '@angular/core';
import { doc, updateDoc, setDoc, Firestore } from '@angular/fire/firestore';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { InfoEmpresa } from 'src/app/shared/models/infoEmpresa.model'; 
import { InfoEmpresaService } from 'src/app/shared/services/info-empresa.service';
import { AuditoriaService } from 'src/app/shared/services/auditoria.service';

@Component({
  selector: 'app-empresa',
  templateUrl: './empresa.component.html',
  styleUrls: ['./empresa.component.css']
})
export class EmpresaComponent {

  infoForm: FormGroup;
  cargando: boolean = true;

  constructor(
    private fb: FormBuilder,
    private infoService: InfoEmpresaService,
    private auditoria: AuditoriaService,
    private firestore: Firestore,
    private snackBar: MatSnackBar
  ) {
    this.infoForm = this.fb.group({
      whatsapp: ['', [Validators.required]],
      // 💳 Cuenta minorista (checkout de minoristas e invitados)
      aliasMinorista: ['', [Validators.required]],
      cvuMinorista: [''],
      titularMinorista: ['', [Validators.required]],
      dniMinorista: ['', [Validators.pattern(/^[\d.\s]{6,12}$/)]],
      // Cuenta mayorista
      aliasMayorista: ['', [Validators.required]],
      cvuMayorista: [''],
      titularMayorista: ['', [Validators.required]],
      dniMayorista: ['', [Validators.pattern(/^[\d.\s]{6,12}$/)]],
      email: ['', [Validators.required, Validators.email]],
      dolar: [0, [Validators.required, Validators.min(1)]],
      dolarJC: [null, [Validators.min(0)]],   // equipos (si queda vacío, se usa el dólar común)
      descuentoEnEfectivo: [0, [Validators.min(0)]],
      descuentoEnTransferencia: [0, [Validators.min(0)]]
    });
  }

  ngOnInit(): void {
    this.infoService.obtenerInfoGeneral().subscribe((data) => {
      if (data) {
        this.infoForm.patchValue(data);
        // Antes había un solo alias: queda como el mayorista hasta que lo cambien
        if (!(data as any).aliasMayorista && (data as any).alias && this.infoForm.get('aliasMayorista')?.pristine) {
          this.infoForm.get('aliasMayorista')?.setValue((data as any).alias);
        }
        // Antes había un solo CVU (el de la cuenta mayorista)
        if (!(data as any).cvuMayorista && (data as any).cvu && this.infoForm.get('cvuMayorista')?.pristine) {
          this.infoForm.get('cvuMayorista')?.setValue((data as any).cvu);
        }
        // Si todavía no se cargó el dólar JC, se propone el dólar común
        if (!(Number((data as any).dolarJC) > 0) && this.infoForm.get('dolarJC')?.pristine) {
          this.infoForm.get('dolarJC')?.setValue((data as any).dolar ?? null);
        }
      }
      this.cargando = false;
    });
  }

  async guardar() {
    if (this.infoForm.invalid) return;

    const v = this.infoForm.value;
    const texto = (x: any) => String(x ?? '').trim();
    const aliasMayorista = texto(v.aliasMayorista);
    const cvuMayorista = texto(v.cvuMayorista);
    const data: InfoEmpresa = {
      ...v,
      aliasMinorista: texto(v.aliasMinorista),
      cvuMinorista: texto(v.cvuMinorista),
      titularMinorista: texto(v.titularMinorista),
      dniMinorista: texto(v.dniMinorista),
      aliasMayorista,
      cvuMayorista,
      titularMayorista: texto(v.titularMayorista),
      dniMayorista: texto(v.dniMayorista),
      alias: aliasMayorista,   // los campos viejos quedan iguales a los de la cuenta mayorista
      cvu: cvuMayorista,
      dolarJC: Number(this.infoForm.value.dolarJC) > 0 ? Number(this.infoForm.value.dolarJC) : null,
      dolarActualizado: new Date()
    };

    const docRef = doc(this.firestore, 'InfoEmpresa/general');

    try {
      const antes = await this.auditoria.capturar('InfoEmpresa', 'general');
      await setDoc(docRef, data, { merge: true });
      const { dolarActualizado, ...datosAuditables } = data as any;
      this.auditoria.registrar({
        accion: 'modificar',
        entidad: 'InfoEmpresa',
        entidadId: 'general',
        descripcion: 'Modificó la información de la empresa (dólar, dólar JC, descuentos, datos de pago)',
        antes,
        despues: datosAuditables
      });
      this.snackBar.open('Información actualizada con éxito', 'Cerrar', { duration: 3000 });
    } catch (error) {
      console.error('Error al guardar', error);
      this.snackBar.open('Error al guardar la información', 'Cerrar', { duration: 3000 });
    }
  }

}
