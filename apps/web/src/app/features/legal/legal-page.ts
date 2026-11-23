import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Markdown } from '../../shared/markdown/markdown';
import { LEGAL_DOCS, UPDATED_AT } from './legal-docs';

/** /privacidade e /termos (o documento vem do "data" da rota). */
@Component({
  selector: 'app-legal-page',
  imports: [Markdown, RouterLink],
  template: `
    @let d = doc();
    <article class="container legal">
      <h1 class="legal__title">{{ d.title }}</h1>
      <p class="legal__intro">{{ d.intro }}</p>
      <p class="legal__date">Atualizado em {{ updatedAt }}</p>
      <app-markdown [source]="d.body" />
      <nav class="legal__other" aria-label="Documentos legais">
        @if (kind() === 'privacidade') {
          <a routerLink="/termos">Leia também os Termos de Uso »</a>
        } @else {
          <a routerLink="/privacidade">Leia também a Política de Privacidade »</a>
        }
      </nav>
    </article>
  `,
  styles: `
    :host { display: block; }
    .legal { max-width: 820px; padding-top: 28px; padding-bottom: 64px; }
    .legal__title {
      display: inline-block;
      margin: 0;
      font-family: var(--font-display);
      font-weight: 800;
      font-size: 40px;
      text-transform: uppercase;
      border-bottom: 3px solid var(--accent);
    }
    .legal__intro { margin: 12px 0 4px; font-size: 17px; color: var(--text); }
    .legal__date { margin: 0 0 24px; font-size: 13px; color: var(--faint); }
    .legal__other { margin-top: 32px; padding-top: 16px; border-top: 1px solid var(--row); }
  `,
})
export class LegalPage {
  /** Vem do "data" da rota */
  readonly kind = input<'privacidade' | 'termos'>('privacidade');
  protected readonly updatedAt = UPDATED_AT;
  protected readonly doc = computed(() => LEGAL_DOCS[this.kind()] ?? LEGAL_DOCS.privacidade);
}
