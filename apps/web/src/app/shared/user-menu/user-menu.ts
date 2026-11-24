import { Component, ElementRef, HostListener, PLATFORM_ID, afterNextRender, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router, RouterLink } from '@angular/router';

import { AuthService } from '../../core/services/auth.service';

const LOGIN_MESSAGES: Record<string, string> = {
  erro: 'Não deu para entrar com a Steam. Tenta de novo.',
  limite: 'Muitas tentativas de login. Espera alguns minutos.',
  suspensa: 'Esta conta está suspensa.',
  excluida: 'Sua conta foi excluída. Seus dados foram apagados.',
};

/** Botão "Entrar com Steam" ou, logado, o avatar com o menu da conta. */
@Component({
  selector: 'app-user-menu',
  imports: [RouterLink],
  template: `
    @switch (state()) {
      @case ('loading') { <span class="placeholder" aria-hidden="true"></span> }
      @case ('guest') {
        <a class="btn-steam" [href]="loginUrl()">Entrar com Steam</a>
      }
      @case ('user') {
        @if (auth.user(); as u) {
          <div class="account">
            <button type="button" class="account__btn" [attr.aria-expanded]="open()" aria-haspopup="menu" (click)="toggle()">
              @if (u.avatar_url) {
                <img class="account__avatar" [src]="u.avatar_url" alt="" width="32" height="32" />
              } @else {
                <span class="account__avatar account__avatar--empty" aria-hidden="true">{{ u.display_name.charAt(0) }}</span>
              }
              <span class="account__name">{{ u.display_name }}</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>
            </button>
            @if (open()) {
              <div class="account__menu" role="menu">
                <span class="account__who">Conectado como <strong>&#64;{{ u.username }}</strong></span>
                <a role="menuitem" class="account__item" [routerLink]="['/u', u.username]" (click)="open.set(false)">Meu perfil</a>
                <a role="menuitem" class="account__item" routerLink="/conta" (click)="open.set(false)">Minha conta</a>
                <button type="button" role="menuitem" class="account__item" (click)="logout()">Sair</button>
              </div>
            }
          </div>
        }
      }
    }
    @if (message()) {
      <p class="toast" [class.toast--ok]="ok()" role="status">{{ message() }}</p>
    }
  `,
  styles: `
    :host { position: relative; display: block; }
    .placeholder { display: block; width: 150px; height: 44px; }
    .btn-steam {
      display: inline-flex;
      align-items: center;
      height: 44px;
      padding: 0 14px;
      border-radius: 2px;
      background: var(--accent);
      color: var(--bg);
      font-family: var(--font-cond);
      font-size: 15px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      text-decoration: none;
      white-space: nowrap;
      &:hover { background: var(--accent-soft); color: var(--bg); }
    }
    .account { position: relative; }
    .account__btn {
      display: flex;
      align-items: center;
      gap: 8px;
      height: 44px;
      padding: 0 10px 0 6px;
      border: 1px solid #2c2c2c;
      border-radius: 2px;
      background: var(--bg);
      color: var(--text-strong);
      font: inherit;
      font-weight: 600;
      cursor: pointer;
      &:hover { border-color: var(--accent); }
    }
    .account__avatar { width: 32px; height: 32px; border-radius: 2px; object-fit: cover; }
    .account__avatar--empty { display: grid; place-items: center; background: #1f1f1f; color: var(--accent); font-weight: 700; text-transform: uppercase; }
    .account__name { max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .account__menu {
      position: absolute;
      top: calc(100% + 6px);
      right: 0;
      z-index: 40;
      display: flex;
      flex-direction: column;
      min-width: 220px;
      padding: 6px;
      background: #161616;
      border: 1px solid #2c2c2c;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
    }
    .account__who { padding: 8px 10px; font-size: 13px; color: var(--muted); strong { color: var(--text-strong); } }
    .account__item {
      display: flex;
      align-items: center;
      text-decoration: none;
      min-height: 40px;
      padding: 0 10px;
      border: 0;
      background: none;
      color: var(--text);
      font: inherit;
      text-align: left;
      cursor: pointer;
      &:hover { background: #222; color: var(--accent-soft); }
    }
    .toast {
      position: absolute;
      top: calc(100% + 8px);
      right: 0;
      z-index: 40;
      width: 280px;
      margin: 0;
      padding: 10px 12px;
      background: #161616;
      border: 1px solid #2c2c2c;
      border-left: 3px solid var(--live);
      font-size: 13px;
      color: var(--text);
    }
    .toast--ok { border-left-color: var(--win); }
  `,
})
export class UserMenu {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  protected readonly open = signal(false);
  protected readonly message = signal<string | null>(null);
  protected readonly ok = signal(false);

  constructor() {
    // Volta da Steam com erro (?login=erro): mostra o aviso e limpa a URL
    afterNextRender(() => {
      const code = new URLSearchParams(location.search).get('login');
      if (!code || !LOGIN_MESSAGES[code]) return;
      this.message.set(LOGIN_MESSAGES[code]);
      this.ok.set(code === 'excluida');
      void this.router.navigate([], { queryParams: { login: null }, queryParamsHandling: 'merge', replaceUrl: true });
      setTimeout(() => this.message.set(null), 6000);
    });
  }

  protected state(): 'loading' | 'guest' | 'user' {
    const u = this.auth.user();
    return u === undefined ? 'loading' : u === null ? 'guest' : 'user';
  }

  protected loginUrl(): string {
    return this.auth.steamLoginUrl(this.isBrowser ? location.pathname + location.search : '/');
  }

  protected toggle(): void {
    this.open.update((o) => !o);
  }

  protected async logout(): Promise<void> {
    this.open.set(false);
    await this.auth.logout();
  }

  @HostListener('document:click', ['$event'])
  protected onDocClick(event: MouseEvent): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) this.open.set(false);
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    this.open.set(false);
  }
}
