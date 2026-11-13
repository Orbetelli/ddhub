import { Component, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { NamePreferenceService } from '../../core/services/name-preference.service';

interface NavItem {
  label: string;
  path: string;
  exact?: boolean;
}

@Component({
  selector: 'app-header',
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './header.html',
  styleUrl: './header.scss',
})
export class Header {
  protected readonly nav: NavItem[] = [
    { label: 'Início', path: '/', exact: true },
    { label: 'Notícias', path: '/noticias' },
    { label: 'Partidas', path: '/partidas' },
    { label: 'Aprender', path: '/aprender' },
    { label: 'Heróis', path: '/herois' },
    { label: 'Itens', path: '/itens' },
    { label: 'Builds', path: '/builds' },
    { label: 'Times', path: '/times' },
    { label: 'Fórum', path: '/forum' },
  ];

  protected readonly names = inject(NamePreferenceService);

  /** Versão do patch exibida na faixa do topo (virá da API). */
  protected readonly patchVersion = signal('[versão]');

  protected readonly menuOpen = signal(false);

  protected toggleMenu(): void {
    this.menuOpen.update((open) => !open);
  }

  protected closeMenu(): void {
    this.menuOpen.set(false);
  }
}