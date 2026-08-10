import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';

@Component({
  selector: 'app-ver-marquesina',
  templateUrl: './ver-marquesina.component.html',
  styleUrls: ['./ver-marquesina.component.css']
})
export class VerMarquesinaComponent {

  constructor(@Inject(MAT_DIALOG_DATA) public marquesina: any) { }

}
