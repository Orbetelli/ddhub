import { Component, computed, inject, input } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, startWith, switchMap } from 'rxjs';

import { NewsService } from '../../core/services/news.service';
import { NewsDetail } from '../../core/models/news.models';
import { ARTICLE_CATEGORY_LABEL } from '../../core/models/portal.models';
import { Markdown } from '../../shared/markdown/markdown';

type LoadState = { status: 'loading' } | { status: 'not-found' } | { status: 'error' } | { status: 'ok'; item: NewsDetail };

@Component({
  selector: 'app-news-article',
  imports: [RouterLink, DatePipe, Markdown],
  templateUrl: './news-article.html',
  styleUrl: './news-article.scss',
})
export class NewsArticle {
  /** Vem da rota /noticias/:slug */
  readonly slug = input.required<string>();

  protected readonly label = ARTICLE_CATEGORY_LABEL;
  private readonly news = inject(NewsService);

  protected readonly state = toSignal(
    toObservable(this.slug).pipe(
      switchMap((slug) =>
        this.news.get(slug).pipe(
          map((item): LoadState => ({ status: 'ok', item })),
          catchError((err: HttpErrorResponse) =>
            of<LoadState>({ status: err.status === 404 || err.status === 400 ? 'not-found' : 'error' }),
          ),
          startWith<LoadState>({ status: 'loading' }),
        ),
      ),
    ),
    { initialValue: { status: 'loading' } as LoadState },
  );

  protected readonly item = computed(() => {
    const s = this.state();
    return s.status === 'ok' ? s.item : null;
  });
}