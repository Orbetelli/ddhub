import { Component, ElementRef, HostListener, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs';

import { NamePreferenceService } from '../../core/services/name-preference.service';

interface NavLink {
  label: string;
  path: string;
  /** Linha curta que aparece embaixo do link no menu suspenso. */
  hint?: string;
  exact?: boolean;
}

interface NavGroup {
  id: string;
  label: string;
  links: NavLink[];
}

type NavEntry = NavLink | NavGroup;

const isGroup = (e: NavEntry): e is NavGroup => 'links' in e;

@Component({
  selector: 'app-header',
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './header.html',
  styleUrl: './header.scss',
})
export class Header {
  /**
   * Menu principal. Seções com várias páginas viram grupos com menu suspenso,
   * para o cabeçalho caber numa linha só.
   */
  protected readonly nav: NavEntry[] = [
    { label: 'Início', path: '/', exact: true },
    { label: 'Notícias', path: '/noticias' },
    {
      id: 'cena',
      label: 'Cena',
      links: [
        { label: 'Partidas', path: '/partidas', hint: 'Resultados e próximos jogos' },
        { label: 'Times', path: '/times', hint: 'Elencos da cena brasileira' },
        { label: 'Torneios', path: '/torneios', hint: 'Campeonatos e chaves' },
        { label: 'Transferências', path: '/transferencias', hint: 'Quem entrou e quem saiu' },
      ],
    },
    {
      id: 'jogo',
      label: 'Jogo',
      links: [
        { label: 'Aprender a jogar', path: '/aprender', hint: 'Guia do básico ao Patrono' },
        { label: 'Heróis', path: '/herois', hint: 'Habilidades e como jogar' },
        { label: 'Itens', path: '/itens', hint: 'A loja completa, por tier' },
        { label: 'Mapa', path: '/mapa', hint: 'Objetivos e acampamentos' },
      ],
    },
    {
      id: 'comunidade',
      label: 'Comunidade',
      links: [
        { label: 'Criadores', path: '/criadores', hint: 'Streamers e YouTubers BR' },
        { label: 'Builds', path: '/builds', hint: 'Builds da comunidade' },
        { label: 'Fórum', path: '/forum', hint: 'Discussões e dúvidas' },
      ],
    },
  ];

  protected readonly isGroup = isGroup;
  protected readonly names = inject(NamePreferenceService);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly router = inject(Router);

  /** Versão do patch exibida na faixa do topo (virá da API). */
  protected readonly patchVersion = signal('[versão]');

  protected readonly menuOpen = signal(false);
  /** Grupo com o menu suspenso aberto (um por vez). */
  protected readonly openGroup = signal<string | null>(null);

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
      startWith(this.router.url),
    ),
    { initialValue: '/' },
  );

  /** Grupo da página atual, para destacar "Jogo" quando estiver em /herois, por exemplo. */
  protected readonly activeGroup = computed(() => {
    const path = this.url().split(/[?#]/)[0];
    const group = this.nav.filter(isGroup).find((g) => g.links.some((l) => path === l.path || path.startsWith(l.path + '/')));
    return group?.id ?? null;
  });

  protected toggleMenu(): void {
    this.menuOpen.update((open) => !open);
    this.openGroup.set(null);
  }

  protected toggleGroup(id: string): void {
    this.openGroup.update((current) => (current === id ? null : id));
  }

  protected closeMenu(): void {
    this.menuOpen.set(false);
    this.openGroup.set(null);
  }

  /** Clique fora do cabeçalho fecha o menu suspenso. */
  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: MouseEvent): void {
    if (this.openGroup() && !this.host.nativeElement.contains(event.target as Node)) this.openGroup.set(null);
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    this.openGroup.set(null);
  }
}