import './vendor.ts';
import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { Ng2Webstorage } from 'ngx-webstorage';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { MAT_DIALOG_DEFAULT_OPTIONS } from '@angular/material';
import { MaterialModule } from './material.module';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { AppSharedModule, UserRouteAccessService } from './shared';
import { AppMainRoutingModule} from './app-routing.module';
import { MainComponent, HeaderComponent, FooterComponent, ErrorComponent, ArticleComponent } from './layouts';
import { AppHomeModule } from './home';

@NgModule({
    imports: [
        FormsModule,
        ReactiveFormsModule,
        BrowserModule,
        BrowserAnimationsModule,
        MaterialModule,
        AppMainRoutingModule,
        Ng2Webstorage.forRoot({ prefix: 'my', separator: '-'}),
        AppSharedModule,
        AppHomeModule,
    ],
    declarations: [
        MainComponent,
        ErrorComponent,
        HeaderComponent,
        FooterComponent,
        ArticleComponent,
    ],
    providers: [
        UserRouteAccessService,
        {
            provide: MAT_DIALOG_DEFAULT_OPTIONS,
            useValue: {
                hasBackdrop: true,
                disableClose: true,
            }
        }
    ],
    bootstrap: [ MainComponent ]
})
export class AppMainModule {}
