import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { API_BASE_URL } from '../api.config';

export type DailyMode = 'habilidade' | 'item' | 'mob' | 'mapa';
export type ChoiceMode = Exclude<DailyMode, 'mapa'>;

export const DAILY_MODES: { mode: DailyMode; label: string; question: string }[] = [
  { mode: 'habilidade', label: 'Habilidade', question: 'De qual herói é esta habilidade?' },
  { mode: 'item', label: 'Item', question: 'Que item é este? A imagem vai abrindo a cada erro.' },
  { mode: 'mob', label: 'Mob', question: 'Que criatura ou estrutura é esta? A silhueta ganha cor a cada erro.' },
  { mode: 'mapa', label: 'Mapa', question: 'Onde fica este pedaço do mapa? Clique no mapa inteiro.' },
];

export interface DailyOption {
  slug: string;
  name: string;
  name_en?: string | null;
  image?: string | null;
}

export interface ChoicePuzzle {
  mode: ChoiceMode;
  number: number;
  date: string;
  max_guesses: number;
  /** Caminho na API (/daily/:modo/image?d=…) */
  image: string;
  focus: { x: number; y: number } | null;
  options: DailyOption[];
  next_at: string;
}

export interface MapPuzzle {
  mode: 'mapa';
  number: number;
  date: string;
  max_guesses: number;
  map_image: string;
  focus: { x: number; y: number };
  next_at: string;
}

export interface ChoiceReveal {
  slug: string;
  name: string;
  link: string;
  detail: string | null;
}

export interface ChoiceGuessResult {
  number: number;
  correct: boolean;
  hints: string[];
  answer: ChoiceReveal | null;
}

export interface MapGuessResult {
  number: number;
  correct: boolean;
  distance: number;
  closeness: string;
  direction: string | null;
  answer: { x: number; y: number; label: string } | null;
}

/** Número do desafio de hoje (igual ao do servidor), para a home mostrar sem chamar a API. */
export function dailyNumberToday(): number {
  const day = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return Math.max(Math.floor((Date.parse(`${day}T00:00:00Z`) - Date.parse('2026-11-23T00:00:00Z')) / 86_400_000) + 1, 1);
}

@Injectable({ providedIn: 'root' })
export class DailyService {
  private readonly http = inject(HttpClient);
  readonly api = inject(API_BASE_URL);

  choice(mode: ChoiceMode): Observable<ChoicePuzzle> {
    return this.http.get<ChoicePuzzle>(`${this.api}/daily/${mode}`);
  }

  map(): Observable<MapPuzzle> {
    return this.http.get<MapPuzzle>(`${this.api}/daily/mapa`);
  }

  guessChoice(mode: ChoiceMode, guess: string, wrong: number): Observable<ChoiceGuessResult> {
    return this.http.post<ChoiceGuessResult>(`${this.api}/daily/${mode}/guess`, { guess, wrong });
  }

  guessMap(x: number, y: number, wrong: number): Observable<MapGuessResult> {
    return this.http.post<MapGuessResult>(`${this.api}/daily/mapa/guess`, { x, y, wrong });
  }
}
