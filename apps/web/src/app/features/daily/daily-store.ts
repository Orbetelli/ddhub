import { DailyMode } from '../../core/services/daily.service';

/**
 * Progresso e estatísticas do Diário, salvos só no navegador (localStorage).
 * Chaves: ddhub.daily.<modo>.<número> e ddhub.daily.stats.<modo>.
 * (A 1ª versão guardava a Habilidade em ddhub.daily.<número> — ainda é lida.)
 */
export interface Stats {
  played: number;
  wins: number;
  streak: number;
  best: number;
  last: number;
}

export interface DayResult {
  done: boolean;
  won: boolean;
  /** Tentativas usadas */
  tries: number;
  max: number;
}

export const EMPTY_STATS: Stats = { played: 0, wins: 0, streak: 0, best: 0, last: 0 };

const key = (mode: DailyMode, n: number) => `ddhub.daily.${mode}.${n}`;
const statsKey = (mode: DailyMode) => `ddhub.daily.stats.${mode}`;

function read<T>(k: string): T | null {
  try {
    const raw = localStorage.getItem(k);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(k: string, v: unknown): void {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* sem armazenamento: joga sem salvar */
  }
}

export function loadProgress<T>(mode: DailyMode, n: number): T | null {
  return read<T>(key(mode, n)) ?? (mode === 'habilidade' ? read<T>(`ddhub.daily.${n}`) : null);
}

export function saveProgress(mode: DailyMode, n: number, p: unknown): void {
  write(key(mode, n), p);
}

export function loadStats(mode: DailyMode): Stats {
  const s = read<Stats>(statsKey(mode)) ?? (mode === 'habilidade' ? read<Stats>('ddhub.daily.stats') : null);
  return { ...EMPTY_STATS, ...(s ?? {}) };
}

/** Registra o fim do desafio de hoje (uma vez por dia). */
export function recordResult(mode: DailyMode, n: number, won: boolean): Stats {
  const s = loadStats(mode);
  if (s.last === n) return s;
  const streak = won ? (s.last === n - 1 ? s.streak + 1 : 1) : 0;
  const next: Stats = { played: s.played + 1, wins: s.wins + (won ? 1 : 0), streak, best: Math.max(s.best, streak), last: n };
  write(statsKey(mode), next);
  return next;
}

/** Resumo do dia de um modo (para a tela geral e o compartilhar). */
export function dayResult(mode: DailyMode, n: number, max: number): DayResult {
  const p = loadProgress<{ guesses?: { correct: boolean }[]; answer?: unknown }>(mode, n);
  const guesses = p?.guesses ?? [];
  const won = guesses.some((g) => g.correct);
  return { done: won || !!p?.answer, won, tries: guesses.length, max };
}

export function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
