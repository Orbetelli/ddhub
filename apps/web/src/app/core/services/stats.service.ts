import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, of, shareReplay } from 'rxjs';

import { API_BASE_URL } from '../api.config';
import { EMPTY_HERO_STATS, HeroStatsResponse } from '../models/stats.models';

/** Estatísticas do jogo (win rate dos heróis). Se a API falhar, vem vazio e a tela esconde o bloco. */
@Injectable({ providedIn: 'root' })
export class StatsService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_BASE_URL);

  private readonly heroes$ = this.http
    .get<HeroStatsResponse>(`${this.api}/stats/heroes`)
    .pipe(catchError(() => of(EMPTY_HERO_STATS)), shareReplay(1));

  heroes(): Observable<HeroStatsResponse> {
    return this.heroes$;
  }
}
