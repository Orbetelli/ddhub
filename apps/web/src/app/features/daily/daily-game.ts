import { Component, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, firstValueFrom, map, of, startWith } from 'rxjs';

import { DailyHero, DailyPuzzle, DailyService } from '../../core/services/daily.service';

interface Guess {
  slug: string;
  correct: boolean;
}

interface Progress {
  guesses: Guess[];
  hints: string[];
  answer: { hero: string; name: string; ability: string; slot: number } | null;
}

interface Stats {
  played: number;
  wins: number;
  streak: number;
  best: number;
  /** Último número jogado (para a sequência) */
  last: number;
}

type LoadState = { status: 'loading' } | { status: 'error' } | { status: 'ok'; p: DailyPuzzle };

const KEY = (n: number) => `ddhub.daily.${n}`;
const STATS_KEY = 'ddhub.daily.stats';
const EMPTY_STATS: Stats = { played: 0, wins: 0, streak: 0, best: 0, last: 0 };

/**
 * /adivinhe — "Adivinhe o herói" diário. O progresso fica no navegador (localStorage);
 * a resposta só vem do servidor quando a pessoa acerta ou usa as 6 chances.
 */
@Component({
  selector: 'app-daily-game',
  imports: [RouterLink],
  templateUrl: './daily-game.html',
  styleUrl: './daily-game.scss',
})
export class DailyGame {
  private readonly daily = inject(DailyService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  protected readonly state = toSignal(
    this.daily.today().pipe(
      map((p): LoadState => {
        this.restore(p.number);
        return { status: 'ok', p };
      }),
      catchError(() => of<LoadState>({ status: 'error' })),
      startWith<LoadState>({ status: 'loading' }),
    ),
    { requireSync: true },
  );

  protected readonly puzzle = computed(() => {
    const s = this.state();
    return s.status === 'ok' ? s.p : null;
  });

  protected readonly progress = signal<Progress>({ guesses: [], hints: [], answer: null });
  protected readonly stats = signal<Stats>(EMPTY_STATS);
  protected readonly query = signal('');
  protected readonly sending = signal(false);
  protected readonly copied = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly wrong = computed(() => this.progress().guesses.filter((g) => !g.correct).length);
  protected readonly won = computed(() => this.progress().guesses.some((g) => g.correct));
  protected readonly finished = computed(() => this.won() || this.progress().answer !== null);
  protected readonly left = computed(() => (this.puzzle()?.max_guesses ?? 6) - this.progress().guesses.length);

  private readonly heroBySlug = computed(() => new Map((this.puzzle()?.heroes ?? []).map((h) => [h.slug, h])));

  protected hero(slug: string): DailyHero | undefined {
    return this.heroBySlug().get(slug);
  }

  /** Heróis que batem com o que foi digitado (e que ainda não foram chutados). */
  protected readonly options = computed(() => {
    const q = norm(this.query());
    if (!q) return [];
    const tried = new Set(this.progress().guesses.map((g) => g.slug));
    return (this.puzzle()?.heroes ?? [])
      .filter((h) => !tried.has(h.slug) && (norm(h.name).includes(q) || norm(h.name_en ?? '').includes(q)))
      .sort((a, b) => Number(!norm(a.name).startsWith(q)) - Number(!norm(b.name).startsWith(q)))
      .slice(0, 6);
  });

  protected readonly squares = computed(() => {
    const max = this.puzzle()?.max_guesses ?? 6;
    const g = this.progress().guesses;
    return Array.from({ length: max }, (_, i) => (i < g.length ? (g[i].correct ? 'hit' : 'miss') : 'empty'));
  });

  protected onInput(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    this.error.set(null);
  }

  protected onEnter(event: Event): void {
    event.preventDefault();
    const first = this.options()[0];
    if (first) void this.guess(first);
  }

  protected async guess(h: DailyHero): Promise<void> {
    const p = this.puzzle();
    if (!p || this.finished() || this.sending()) return;
    this.sending.set(true);
    try {
      const res = await firstValueFrom(this.daily.guess(h.slug, this.wrong()));
      if (res.number !== p.number) {
        this.error.set('Virou o dia! Recarregue a página para o desafio novo.');
        return;
      }
      const next: Progress = {
        guesses: [...this.progress().guesses, { slug: h.slug, correct: res.correct }],
        hints: res.hints,
        answer: res.answer,
      };
      this.progress.set(next);
      this.query.set('');
      this.save(p.number, next);
      if (res.correct || res.answer) this.record(p.number, res.correct);
    } catch {
      this.error.set('Não deu para enviar o palpite. Tenta de novo.');
    } finally {
      this.sending.set(false);
    }
  }

  protected async share(): Promise<void> {
    const p = this.puzzle();
    if (!p) return;
    const line = this.squares()
      .filter((s) => s !== 'empty')
      .map((s) => (s === 'hit' ? '🟩' : '🟥'))
      .join('');
    const text = `DDhub · Adivinhe o herói #${p.number}\n${line}${this.won() ? '' : ' ❌'}\nddhub-br.vercel.app/adivinhe`;
    try {
      if (navigator.share) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        this.copied.set(true);
        setTimeout(() => this.copied.set(false), 2500);
      }
    } catch {
      /* compartilhamento cancelado */
    }
  }

  protected nextIn(): string {
    const p = this.puzzle();
    if (!p) return '';
    const ms = Math.max(Date.parse(p.next_at) - Date.now(), 0);
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    return `${h}h ${String(m).padStart(2, '0')}min`;
  }

  // ───────── progresso no navegador ─────────
  private restore(n: number): void {
    if (!this.isBrowser) return;
    try {
      const raw = localStorage.getItem(KEY(n));
      if (raw) this.progress.set(JSON.parse(raw) as Progress);
      const s = localStorage.getItem(STATS_KEY);
      if (s) this.stats.set({ ...EMPTY_STATS, ...(JSON.parse(s) as Stats) });
    } catch {
      /* armazenamento indisponível: joga sem salvar */
    }
  }

  private save(n: number, p: Progress): void {
    if (!this.isBrowser) return;
    try {
      localStorage.setItem(KEY(n), JSON.stringify(p));
    } catch {
      /* sem armazenamento */
    }
  }

  private record(n: number, won: boolean): void {
    const s = this.stats();
    if (s.last === n) return;
    const streak = won ? (s.last === n - 1 ? s.streak + 1 : 1) : 0;
    const next: Stats = { played: s.played + 1, wins: s.wins + (won ? 1 : 0), streak, best: Math.max(s.best, streak), last: n };
    this.stats.set(next);
    if (!this.isBrowser) return;
    try {
      localStorage.setItem(STATS_KEY, JSON.stringify(next));
    } catch {
      /* sem armazenamento */
    }
  }
}

function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
