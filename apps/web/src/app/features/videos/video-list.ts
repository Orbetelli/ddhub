import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map, startWith } from 'rxjs';

import { Video, VideosService } from '../../core/services/videos.service';
import { VideoCard } from '../../shared/video-card/video-card';

type LoadState = { status: 'loading' } | { status: 'ok'; videos: Video[] };

/** /videos — últimos vídeos de Deadlock dos criadores BR. */
@Component({
  selector: 'app-video-list',
  imports: [RouterLink, VideoCard],
  template: `
    <section class="container page">
      <header class="head">
        <div>
          <h1 class="title">Vídeos BR</h1>
          <p class="intro">Os vídeos de Deadlock mais recentes dos criadores brasileiros. Atualizado a cada 30 minutos.</p>
        </div>
        <a class="head__link" routerLink="/criadores">Ver criadores »</a>
      </header>
      @switch (state().status) {
        @case ('loading') { <p class="status">Carregando vídeos…</p> }
        @default {
          @if (videos().length) {
            <ul class="grid">
              @for (v of videos(); track v.id) { <li><app-video-card [video]="v" /></li> }
            </ul>
          } @else {
            <div class="notice">
              <strong>Nenhum vídeo por aqui ainda.</strong>
              <span>Os vídeos aparecem quando os criadores com YouTube cadastrado postarem sobre Deadlock.</span>
            </div>
          }
        }
      }
    </section>
  `,
  styles: `
    :host { display: block; }
    .page { padding-top: 24px; padding-bottom: 56px; }
    .head { display: flex; align-items: flex-end; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-bottom: 22px; }
    .head__link { font-weight: 700; color: var(--accent); }
    .title {
      display: inline-block;
      margin: 0;
      font-family: var(--font-display);
      font-weight: 800;
      font-size: 44px;
      text-transform: uppercase;
      border-bottom: 3px solid var(--accent);
    }
    .intro { max-width: 680px; margin: 10px 0 0; color: var(--muted); }
    .status { color: var(--muted); }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 22px 18px; margin: 0; padding: 0; list-style: none; }
    .notice {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 16px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-left: 3px solid var(--accent);
      span { font-size: 14px; color: var(--muted); }
    }
  `,
})
export class VideoList {
  protected readonly state = toSignal(
    inject(VideosService)
      .list(60)
      .pipe(
        map((videos): LoadState => ({ status: 'ok', videos })),
        startWith<LoadState>({ status: 'loading' }),
      ),
    { requireSync: true },
  );

  protected videos(): Video[] {
    const s = this.state();
    return s.status === 'ok' ? s.videos : [];
  }
}
