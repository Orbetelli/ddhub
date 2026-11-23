import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, of } from 'rxjs';

import { API_BASE_URL } from '../api.config';

export type SearchType = 'heroi' | 'item' | 'time' | 'jogador' | 'criador' | 'torneio' | 'noticia' | 'aprender';

export interface SearchResult {
  type: SearchType;
  label: string;
  sub: string | null;
  url: string;
  image: string | null;
}

export const SEARCH_TYPE_LABEL: Record<SearchType, string> = {
  heroi: 'Herói',
  item: 'Item',
  time: 'Time',
  jogador: 'Jogador',
  criador: 'Criador',
  torneio: 'Torneio',
  noticia: 'Notícia',
  aprender: 'Aprender',
};

@Injectable({ providedIn: 'root' })
export class SearchService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_BASE_URL);

  search(q: string): Observable<SearchResult[]> {
    return this.http
      .get<SearchResult[]>(`${this.api}/search?q=${encodeURIComponent(q)}`)
      .pipe(catchError(() => of<SearchResult[]>([])));
  }
}
