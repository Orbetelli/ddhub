import { Component, input } from '@angular/core';
import { DatePipe } from '@angular/common';

import { Video } from '../../core/services/videos.service';

/** Card de vídeo do YouTube (abre no YouTube, em nova aba — o site não incorpora o player). */
@Component({
  selector: 'app-video-card',
  imports: [DatePipe],
  template: `
    @let v = video();
    <a class="card" [href]="v.url" target="_blank" rel="noopener noreferrer">
      <span class="thumb">
        <img [src]="v.thumbnail" alt="" loading="lazy" width="480" height="360" />
        <span class="play" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"></path></svg>
        </span>
      </span>
      <span class="title">{{ v.title }}</span>
      <span class="meta">
        @if (v.creator.avatar_url) { <img class="avatar" [src]="v.creator.avatar_url" alt="" width="20" height="20" loading="lazy" /> }
        <span>{{ v.creator.name }} · {{ v.published_at | date: 'dd/MM' }}</span>
      </span>
      <span class="sr-only">(abre no YouTube em nova aba)</span>
    </a>
  `,
  styles: `
    :host { display: block; }
    .card { display: flex; flex-direction: column; gap: 8px; color: var(--text); text-decoration: none; }
    .card:hover { color: var(--text); }
    .thumb { position: relative; display: block; overflow: hidden; aspect-ratio: 16 / 9; border-radius: 14px; background: #111; }
    .thumb img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.25s; }
    .card:hover .thumb img { transform: scale(1.04); }
    .play {
      position: absolute;
      right: 10px;
      bottom: 10px;
      display: grid;
      place-items: center;
      width: 38px;
      height: 38px;
      border-radius: 50%;
      background: rgba(10, 10, 10, 0.8);
      color: #fff;
    }
    .card:hover .play { background: #ff3b3b; }
    .title {
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      font-weight: 700;
      line-height: 1.3;
      color: var(--text-strong);
    }
    .meta { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--muted); }
    .avatar { border-radius: 50%; object-fit: cover; }
    @media (prefers-reduced-motion: reduce) { .thumb img { transition: none; } .card:hover .thumb img { transform: none; } }
  `,
})
export class VideoCard {
  readonly video = input.required<Video>();
}
