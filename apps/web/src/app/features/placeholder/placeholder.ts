import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * Página provisória das seções que ainda não foram construídas.
 * `heading` e `notFound` chegam do `data` da rota (withComponentInputBinding).
 */
@Component({
  selector: 'app-placeholder',
  imports: [RouterLink],
  template: `
    <section class="container page">
      <h1 class="page__title">{{ heading() }}</h1>
      @if (notFound()) {
        <p>Essa página não existe (ou ainda não existe).</p>
      } @else {
        <p>Seção em construção. Volta daqui a pouco!</p>
      }
      <a routerLink="/" class="page__back">« Voltar para o início</a>
    </section>
  `,
  styles: `
    .page { padding-top: 48px; padding-bottom: 64px; }
    .page__title {
      font-family: var(--font-display);
      font-weight: 800;
      font-size: 40px;
      text-transform: uppercase;
      border-bottom: 3px solid var(--accent);
      display: inline-block;
      margin-bottom: 12px;
    }
    p { color: var(--muted); }
    .page__back { color: var(--accent-soft); }
  `,
})
export class Placeholder {
  readonly heading = input('');
  readonly notFound = input(false);
}
