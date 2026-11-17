import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { toSignal } from '@angular/core/rxjs-interop';
import { Observable, catchError, of, shareReplay } from 'rxjs';

import { API_BASE_URL } from '../api.config';
import { NewsDetail, NewsItem, SiteMeta } from '../models/news.models';

@Injectable({ providedIn: 'root' })
export class NewsService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_BASE_URL);

  private readonly list$ = this.http.get<NewsItem[]>(`${this.api}/news?limit=100`).pipe(shareReplay(1));

  /** Último patch (faixa do topo). Carrega uma vez por visita. */
  readonly meta = toSignal(
    this.http.get<SiteMeta>(`${this.api}/meta`).pipe(catchError(() => of<SiteMeta>({ patch: null }))),
    { initialValue: { patch: null } as SiteMeta },
  );

  list(): Observable<NewsItem[]> {
    return this.list$;
  }

  get(slug: string): Observable<NewsDetail> {
    return this.http.get<NewsDetail>(`${this.api}/news/${encodeURIComponent(slug)}`);
  }
}