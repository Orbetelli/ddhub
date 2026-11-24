import { Component, input } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';

import { BuildCard as Build } from '../../core/services/builds.service';

/** Cartão de build para listas (builds, perfil, herói). */
@Component({
  selector: 'app-build-card',
  imports: [DatePipe, RouterLink],
  template: `
    @let b = build();
    <a class="card" [routerLink]="['/builds', b.id]">
      <div class="top">
        @if (b.hero?.image) {
          <img class="hero" [src]="b.hero!.image" [alt]="b.hero!.name" width="48" height="48" loading="lazy" />
        }
        <div class="info">
          <strong class="title">{{ b.title }}</strong>
          <span class="meta">
            {{ b.hero?.name }}
            @if (showAuthor() && b.author) {
              · por {{ b.author.display_name }}
            }
            · {{ b.updated_at | date: 'dd/MM/yy' }}
          </span>
        </div>
        <span class="score" [class.neg]="b.score < 0" title="Votos">{{ b.score > 0 ? '+' + b.score : b.score }}</span>
      </div>
      <div class="items">
        @for (i of b.preview; track i.slug) {
          <img [src]="i.image_url" [alt]="i.name" [title]="i.name" [class]="'slot-' + i.slot" width="34" height="34" loading="lazy" />
        }
        @if (b.item_count > b.preview.length) {
          <span class="more">+{{ b.item_count - b.preview.length }}</span>
        }
      </div>
      <div class="tags">
        @if (!b.published) {
          <span class="tag tag--draft">Rascunho</span>
        }
        @if (b.outdated) {
          <span class="tag" title="Feita antes do último patch: pode estar desatualizada">Antes do último patch</span>
        }
      </div>
    </a>
  `,
  styles: `
    .card { display: flex; flex-direction: column; gap: 10px; height: 100%; padding: 14px; background: var(--surface); border: 1px solid var(--border); color: var(--text); text-decoration: none; transition: border-color .15s; }
    .card:hover { border-color: var(--accent); color: var(--text); }
    .top { display: flex; gap: 10px; align-items: center; }
    .hero { width: 48px; height: 48px; border-radius: 4px; object-fit: cover; flex: none; }
    .info { display: flex; flex-direction: column; min-width: 0; flex: 1; }
    .title { color: var(--text-strong); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .meta { font-size: 13px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .score { font-family: var(--font-display); font-size: 20px; color: var(--win); }
    .score.neg { color: var(--live); }
    .items { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
    .items img { width: 34px; height: 34px; border-radius: 4px; background: var(--bg-deep); border-bottom: 2px solid transparent; }
    .items .slot-weapon { border-color: #e8913a; }
    .items .slot-vitality { border-color: #6fbf4a; }
    .items .slot-spirit { border-color: #a46cd8; }
    .more { font-size: 13px; color: var(--muted); padding-left: 4px; }
    .tags { display: flex; gap: 6px; flex-wrap: wrap; margin-top: auto; }
    .tag { font-size: 11px; padding: 2px 6px; background: var(--surface-sub); color: var(--muted); }
    .tag--draft { background: var(--accent-soft); color: var(--text-strong); }
    .tags:empty { display: none; }
  `,
})
export class BuildCard {
  readonly build = input.required<Build>();
  readonly showAuthor = input(true);
}
