import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, shareReplay } from 'rxjs';

import { API_BASE_URL } from '../api.config';
import {
  MatchCard,
  PlayerDetail,
  TeamCard,
  TeamDetail,
  TournamentCard,
  TournamentDetail,
  TransferEvent,
} from '../models/scene.models';

@Injectable({ providedIn: 'root' })
export class SceneService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_BASE_URL);

  private readonly teams$ = this.http.get<TeamCard[]>(`${this.api}/teams`).pipe(shareReplay(1));

  teams(): Observable<TeamCard[]> {
    return this.teams$;
  }

  team(slug: string): Observable<TeamDetail> {
    return this.http.get<TeamDetail>(`${this.api}/teams/${encodeURIComponent(slug)}`);
  }

  player(slug: string): Observable<PlayerDetail> {
    return this.http.get<PlayerDetail>(`${this.api}/players/${encodeURIComponent(slug)}`);
  }

  transfers(limit = 100): Observable<TransferEvent[]> {
    return this.http.get<TransferEvent[]>(`${this.api}/transfers?limit=${limit}`);
  }

  tournaments(): Observable<TournamentCard[]> {
    return this.http.get<TournamentCard[]>(`${this.api}/tournaments`);
  }

  tournament(slug: string): Observable<TournamentDetail> {
    return this.http.get<TournamentDetail>(`${this.api}/tournaments/${encodeURIComponent(slug)}`);
  }

  /** status: upcoming (ao vivo + próximas) | results (terminadas) | all */
  matches(opts: { status?: 'upcoming' | 'results' | 'all'; team?: string; limit?: number } = {}): Observable<MatchCard[]> {
    const params = new URLSearchParams();
    if (opts.status) params.set('status', opts.status);
    if (opts.team) params.set('team', opts.team);
    params.set('limit', String(opts.limit ?? 50));
    return this.http.get<MatchCard[]>(`${this.api}/matches?${params}`);
  }
}
