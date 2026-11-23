import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Header } from './layout/header/header';
import { Footer } from './layout/footer/footer';
import { PrivacyNotice } from './shared/privacy-notice/privacy-notice';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, Header, Footer, PrivacyNotice],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {}
