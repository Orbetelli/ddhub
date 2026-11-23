import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { API_BASE_URL } from '../api.config';

export interface DailyHero {
  slug: string;
  name: string;
  name_en: string | null;
  image: string | null;
}

export interface DailyPuzzle {
  number: number;
  date: string;
  max_guesses: number;
  icon: string;
  heroes: DailyHero[];
  next_at: string;
}

export interface DailyGuessResult {
  number: number;
  correct: boolean;
  hints: string[];
  answer: { hero: string; name: string; ability: string; slot: number } | null;
}

/** Número do desafio de hoje (igual ao do servidor), para a home mostrar sem chamar a API. */
export function dailyNumberToday(): number {
  const day = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return Math.max(Math.floor((Date.parse(`${day}T00:00:00Z`) - Date.parse('2026-11-24T00:00:00Z')) / 86_400_000) + 1, 1);
}

@Injectable({ providedIn: 'root' })
export class DailyService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_BASE_URL);

  today(): Observable<DailyPuzzle> {
    return this.http.get<DailyPuzzle>(`${this.api}/daily`);
  }

  guess(hero: string, wrong: number): Observable<DailyGuessResult> {
    return this.http.post<DailyGuessResult>(`${this.api}/daily/guess`, { hero, wrong });
  }
}
