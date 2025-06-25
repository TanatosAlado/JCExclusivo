import { Injectable } from '@angular/core';
import { MatSnackBar, MatSnackBarConfig } from '@angular/material/snack-bar';

@Injectable({
  providedIn: 'root'
})
export class ToastService {
 constructor( private toats:MatSnackBar) { }

  toastMessage(message:string,backgroundColor:string, tiempo:number) {
    const snackBarConfig:MatSnackBarConfig={
      duration:tiempo,
      panelClass:[...this.getBackgroundColorClasses(backgroundColor)],
      data:{backgroundColor}
  }
  this.toats.open(message,'',snackBarConfig)
    };
    private getBackgroundColorClasses(backgroundColor: string): string[] {
      return [`estilosSnackBar`, `background-color-${backgroundColor}`];
    }
}
