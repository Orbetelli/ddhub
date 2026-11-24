import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, firstValueFrom } from 'rxjs';

import { API_BASE_URL } from '../api.config';

/**
 * Leitura pública vai direto na API; o que precisa de login (criar, editar, votar,
 * "minhas builds" e o detalhe com o seu voto) passa por /api, no próprio site, por causa do cookie.
 */
const SITE_API = '/api';

export type BuildPhase = 'early' | 'mid' | 'late' | 'situational';

export const PHASE_LABEL: Record<BuildPhase, string> = {
  early: 'Início',
  mid: 'Meio',
  late: 'Fim',
  situational: 'Situacional',
};
export const PHASES: BuildPhase[] = ['early', 'mid', 'late', 'situational'];

export interface BuildCard {
  id: string;
  title: string;
  hero: { slug: string; name: string; name_en: string | null; image: string | null } | null;
  author: { username: string; display_name: string; avatar_url: string | null } | null;
  score: number;
  published: boolean;
  patch: string | null;
  outdated: boolean;
  item_count: number;
  preview: { slug: string; name: string; image_url: string | null; slot: string | null }[];
  created_at: string;
  updated_at: string;
}

export interface BuildItem {
  slug: string;
  name: string;
  name_en: string | null;
  slot: 'weapon' | 'vitality' | 'spirit' | null;
  tier: number | null;
  cost: number | null;
  image_url: string | null;
  note: string | null;
}

export interface BuildDetail extends BuildCard {
  description: string | null;
  phases: { phase: BuildPhase; items: BuildItem[]; cost: number }[];
  my_vote: number;
  can_edit: boolean;
  can_delete: boolean;
}

export interface BuildInput {
  hero: string;
  title: string;
  description: string;
  published: boolean;
  items: { item: string; phase: BuildPhase; note?: string }[];
}

@Injectable({ providedIn: 'root' })
export class BuildsService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_BASE_URL);

  list(hero: string | null, sort: 'top' | 'novas', page = 1): Observable<{ page: number; total: number; builds: BuildCard[] }> {
    const params: Record<string, string> = { ordem: sort, pagina: String(page) };
    if (hero) params['heroi'] = hero;
    return this.http.get<{ page: number; total: number; builds: BuildCard[] }>(`${this.api}/builds`, { params });
  }

  byUser(username: string): Observable<{ builds: BuildCard[] }> {
    return this.http.get<{ builds: BuildCard[] }>(`${this.api}/users/${encodeURIComponent(username)}/builds`);
  }

  mine(): Promise<{ builds: BuildCard[] }> {
    return firstValueFrom(this.http.get<{ builds: BuildCard[] }>(`${SITE_API}/builds/mine`));
  }

  get(id: string): Observable<BuildDetail> {
    return this.http.get<BuildDetail>(`${SITE_API}/builds/${encodeURIComponent(id)}`);
  }

  create(input: BuildInput): Promise<{ id: string }> {
    return firstValueFrom(this.http.post<{ id: string }>(`${SITE_API}/builds`, input));
  }

  update(id: string, input: BuildInput): Promise<{ id: string }> {
    return firstValueFrom(this.http.put<{ id: string }>(`${SITE_API}/builds/${encodeURIComponent(id)}`, input));
  }

  remove(id: string): Promise<unknown> {
    return firstValueFrom(this.http.delete(`${SITE_API}/builds/${encodeURIComponent(id)}`));
  }

  vote(id: string, value: 1 | -1 | 0): Promise<{ score: number; my_vote: number }> {
    return firstValueFrom(this.http.post<{ score: number; my_vote: number }>(`${SITE_API}/builds/${encodeURIComponent(id)}/vote`, { value }));
  }
}
