import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { API_BASE_URL } from '../api.config';
import { Chapter, ChapterSummary } from '../models/learn.models';

@Injectable({ providedIn: 'root' })
export class LearnService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_BASE_URL);

  list(): Observable<ChapterSummary[]> {
    return this.http.get<ChapterSummary[]>(`${this.api}/learn`);
  }

  get(slug: string): Observable<Chapter> {
    return this.http.get<Chapter>(`${this.api}/learn/${encodeURIComponent(slug)}`);
  }
}