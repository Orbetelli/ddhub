import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { API_BASE_URL } from '../api.config';
import { HeroCard, HeroDetail } from '../models/hero.models';

@Injectable({ providedIn: 'root' })
export class HeroesService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_BASE_URL);

  list(): Observable<HeroCard[]> {
    return this.http.get<HeroCard[]>(`${this.api}/heroes`);
  }

  get(slug: string): Observable<HeroDetail> {
    return this.http.get<HeroDetail>(`${this.api}/heroes/${encodeURIComponent(slug)}`);
  }
}