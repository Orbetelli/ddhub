import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-footer',
  imports: [RouterLink],
  template: `
    <footer class="footer">
      <div class="container footer__inner">
        <span>DDhub · feito por jogador, pra jogador</span>
        <nav class="footer__links" aria-label="Rodapé">
          <a routerLink="/forum">Fórum</a>
          <a routerLink="/aprender">Comece por aqui</a>
        </nav>
        <span>Site de fã, sem vínculo com a Valve.</span>
      </div>
    </footer>
  `,
  styles: `
    :host { display: block; }
    .footer {
      border-top: 1px solid var(--row);
      background: var(--bg-deep);
      font-size: 12px;
      color: var(--faint);
    }
    .footer__inner {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 8px 24px;
      padding-top: 18px;
      padding-bottom: 18px;
    }
    .footer__links { display: flex; gap: 16px; }
  `,
})
export class Footer {}
