import { Component, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { BuildCard as Build, BuildsService } from '../../core/services/builds.service';
import { AuthService } from '../../core/services/auth.service';
import { BuildCard } from '../../shared/build-card/build-card';

/** /builds/minhas — as suas builds, inclusive rascunhos. */
@Component({
  selector: 'app-my-builds',
  imports: [RouterLink, BuildCard],
  template: `
    <section class="container page">
      <header class="head">
        <div>
          <a routerLink="/builds" class="small">« Builds</a>
          <h1>Minhas builds</h1>
          <p class="sub">Rascunhos só você vê. Publicadas aparecem para todo mundo e recebem votos.</p>
        </div>
        @if (auth.user()) {
          <a class="btn" routerLink="/builds/nova">Criar build</a>
        }
      </header>
      @if (auth.user() === undefined || (auth.user() && !loaded())) {
        <p class="muted">Carregando…</p>
      } @else if (!auth.user()) {
        <div class="empty">
          <p>Entre com a Steam para ver e criar as suas builds.</p>
          <a class="btn" [href]="auth.steamLoginUrl('/builds/minhas')">Entrar com Steam</a>
        </div>
      } @else if (error()) {
        <p class="muted">Não deu para carregar agora.</p>
      } @else if (!builds().length) {
        <div class="empty">
          <p>Você ainda não montou nenhuma build.</p>
          <a class="btn" routerLink="/builds/nova">Criar a primeira</a>
        </div>
      } @else {
        <div class="grid">
          @for (b of builds(); track b.id) {
            <app-build-card [build]="b" [showAuthor]="false" />
          }
        </div>
      }
    </section>
  `,
  styleUrl: './builds.scss',
})
export class MyBuilds {
  protected readonly auth = inject(AuthService);
  private readonly service = inject(BuildsService);

  protected readonly builds = signal<Build[]>([]);
  protected readonly loaded = signal(false);
  protected readonly error = signal(false);

  constructor() {
    effect(() => {
      if (this.auth.user() && !this.loaded()) {
        this.service
          .mine()
          .then((r) => this.builds.set(r.builds))
          .catch(() => this.error.set(true))
          .finally(() => this.loaded.set(true));
      }
    });
  }
}
