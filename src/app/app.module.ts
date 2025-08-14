import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { SharedModule } from './shared/shared.module';
import { AdminModule } from './modules/admin/admin.module';
import { AuthModule } from './modules/auth/auth.module';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { provideStorage, getStorage } from '@angular/fire/storage';
import { provideFirebaseApp, initializeApp } from '@angular/fire/app'; // API modular
import { provideAuth, getAuth } from '@angular/fire/auth'; // Para Auth (si lo usas)
import { provideFirestore, getFirestore } from '@angular/fire/firestore'; // Para Firestore (si lo usas)
import { environment } from 'src/environment/environment';
import { ShopModule } from './modules/shop/shop.module';
import { DespachoModule } from './modules/despacho/despacho.module';

@NgModule({
  declarations: [
    AppComponent
  ],
  imports: [
    BrowserModule,
    AppRoutingModule,
    SharedModule,
    AdminModule,
    AuthModule,
    BrowserAnimationsModule,
    ShopModule,
    DespachoModule,
    provideFirebaseApp(() => initializeApp(environment.firebase)),
    provideAuth(() => getAuth()),
    provideFirestore(() => getFirestore()),
    provideStorage(() => getStorage()), // Solo si usas Firestore
  ],
  providers: [],
  bootstrap: [AppComponent]
})
export class AppModule { }
