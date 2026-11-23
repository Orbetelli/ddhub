import { Component, PLATFORM_ID, afterNextRender, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { RouterLink } from '@angular/router';

const STORAGE_KEY = 'ddhub.privacyNotice';
/** Mude quando a política mudar de verdade (ex.: lançamento do login): o aviso aparece de novo. */
const NOTICE_VERSION = '2026-11-24';

/**
 * Aviso de privacidade no rodapé da tela. Não é um "aceite de cookies": o DDhub não usa
 * cookies de rastreamento, então o aviso só informa e some quando a pessoa clica em "Entendi".
 */
@Component({
  selector: 'app-privacy-notice',
  imports: [RouterLink],
  template: `
    @if (visible()) {
      <aside class="notice" role="region" aria-label="Aviso de privacidade">
        <p class="notice__text">
          O DDhub não usa cookies de rastreamento. Guardamos só a preferência de nomes (PT/EN) e, se você entrar com a Steam, um cookie essencial de sessão.
          <a routerLink="/privacidade">Política de Privacidade</a>
        </p>
        <button type="button" class="notice__btn" (click)="dismiss()">Entendi</button>
      </aside>
    }
  `,
  styles: `
    .notice {
      position: fixed;
      right: 16px;
      bottom: 16px;
      left: 16px;
      z-index: 50;
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 10px 16px;
      max-width: 720px;
      margin: 0 auto;
      padding: 12px 16px;
      background: #161616;
      border: 1px solid #2c2c2c;
      border-left: 3px solid var(--accent);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
    }
    .notice__text { flex: 1 1 320px; margin: 0; font-size: 13px; line-height: 1.45; color: var(--text); }
    .notice__text a { margin-left: 4px; font-weight: 600; color: var(--accent-soft); }
    .notice__btn {
      min-height: 40px;
      padding: 0 18px;
      border: 0;
      background: var(--accent);
      color: #140a02;
      font-family: var(--font-cond);
      font-weight: 700;
      font-size: 15px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      cursor: pointer;
    }
    .notice__btn:hover { background: var(--accent-soft); }
  `,
})
export class PrivacyNotice {
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  protected readonly visible = signal(false);

  constructor() {
    afterNextRender(() => {
      try {
        this.visible.set(localStorage.getItem(STORAGE_KEY) !== NOTICE_VERSION);
      } catch {
        this.visible.set(false);
      }
    });
  }

  dismiss(): void {
    this.visible.set(false);
    if (!this.isBrowser) return;
    try {
      localStorage.setItem(STORAGE_KEY, NOTICE_VERSION);
    } catch {
      /* navegador bloqueou o armazenamento: o aviso só volta na próxima visita */
    }
  }
}
