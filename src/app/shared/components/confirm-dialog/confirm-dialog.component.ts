import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

@Component({
  selector: 'app-confirm-dialog',
  templateUrl: './confirm-dialog.component.html',
  styleUrls: ['./confirm-dialog.component.css']
})
export class ConfirmDialogComponent {
constructor(
    public dialogRef: MatDialogRef<ConfirmDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { message: string, confirmAction: () => void }
  ) {}

  // Cierra el modal sin hacer nada
  onCancel(): void {
    this.dialogRef.close();
  }

  onConfirm(): void {
    if (this.data.confirmAction) {
      this.data.confirmAction();
    }
    this.dialogRef.close();
  }
}
