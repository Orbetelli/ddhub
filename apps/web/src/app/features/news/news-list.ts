import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, startWith } from 'rxjs';

import { NewsService } from '../../core/services/news.service';
import { NewsItem } from '../../core/models/news.models';
import { ARTICLE_CATEGORY_LABEL, ArticleCategory } from '../../core/models/portal.models';

type LoadState = { status: 'loading' } | { status: 'error' } | { status: 'ok'; items: NewsItem[] };

@Component({
  selector: 'app-news-list',
  imports: [RouterLink, DatePipe],
  templateUrl: './news-list.html',
  styleUrl: './news-list.scss',
})
export class NewsList {
  protected readonly label = ARTICLE_CATEGORY_LABEL;
  protected readonly filters: { id: ArticleCategory | null; label: string }[] = [
    { id: null, label: 'Todas' },
    { id: 'patch', label: 'Patches' },
    { id: 'guia', label: 'Guias' },
    { id: 'cenario', label: 'Cenário' },
    { id: 'comunidade', label: 'Comunidade' },
  ];

  protected readonly state = toSignal(
    inject(NewsService)
      .list()
      .pipe(
        map((items): LoadState => ({ status: 'ok', items })),
        catchError(() => of<LoadState>({ status: 'error' })),
        startWith<LoadState>({ status: 'loading' }),
      ),
    { requireSync: true },
  );

  protected readonly category = signal<ArticleCategory | null>(null);

  private readonly items = computed(() => {
    const s = this.state();
    if (s.status !== 'ok') return [];
    const c = this.category();
    return c ? s.items.filter((n) => n.category === c) : s.items;
  });

  /** A mais recente vira destaque; o resto vai para a lista. */
  protected readonly featured = computed(() => this.items()[0] ?? null);
  protected readonly rest = computed(() => this.items().slice(1));

  protected readonly skeleton = [1, 2, 3, 4];
}