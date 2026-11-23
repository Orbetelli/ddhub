import { Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { DAILY_MODES, DailyMode, dailyNumberToday } from '../../core/services/daily.service';
import { ChoiceGame } from './choice-game';
import { MapGame } from './map-game';
import { dayResult, DayResult } from './daily-store';

const MAX: Record<DailyMode, number> = { habilidade: 6, item: 6, mob: 6, mapa: 5 };

/** DDhub Diário: 4 desafios por dia (Habilidade, Item, Mob, Mapa). Aba escolhida em ?modo= */
@Component({
  selector: 'app-daily-page',
  imports: [RouterLink, ChoiceGame, MapGame],
  templateUrl: './daily-page.html',
  styleUrl: './daily-page.scss',
})
export class DailyPage {
  /** Vem da URL (?modo=item) */
  readonly modo = input<string | undefined>();

  protected readonly modes = DAILY_MODES;
  protected readonly number = dailyNumberToday();
  protected readonly current = computed<DailyMode>(() => {
    const m = this.modo();
    return DAILY_MODES.some((x) => x.mode === m) ? (m as DailyMode) : 'habilidade';
  });
  protected readonly question = computed(() => DAILY_MODES.find((m) => m.mode === this.current())!.question);

  /** Recalculado quando um desafio termina */
  private readonly tick = signal(0);
  protected readonly results = computed<Record<DailyMode, DayResult>>(() => {
    this.tick();
    return Object.fromEntries(DAILY_MODES.map(({ mode }) => [mode, dayResult(mode, this.number, MAX[mode])])) as Record<DailyMode, DayResult>;
  });
  protected readonly doneCount = computed(() => Object.values(this.results()).filter((r) => r.done).length);

  protected readonly countdown = signal(this.timeLeft());
  protected readonly copied = signal(false);

  constructor() {
    const id = setInterval(() => this.countdown.set(this.timeLeft()), 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(id));
  }

  protected refresh(): void {
    this.tick.update((n) => n + 1);
  }

  protected badge(mode: DailyMode): string {
    const r = this.results()[mode];
    return !r.done ? '' : r.won ? '🟩' : '🟥';
  }

  protected shareText(): string {
    const lines = DAILY_MODES.map(({ mode, label }) => {
      const r = this.results()[mode];
      if (!r.done) return `⬜ ${label} —`;
      return `${r.won ? '🟩' : '🟥'} ${label} ${r.won ? r.tries : 'X'}/${r.max}`;
    });
    return [`DDhub Diário #${this.number}`, ...lines, 'ddhub-br.vercel.app/diario'].join('\n');
  }

  protected async share(): Promise<void> {
    const text = this.shareText();
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ text });
        return;
      }
      await navigator.clipboard.writeText(text);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
      /* cancelado */
    }
  }

  /** Tempo até a meia-noite de Brasília (UTC-3). */
  private timeLeft(): string {
    const now = Date.now();
    const brt = now - 3 * 3_600_000;
    const next = (Math.floor(brt / 86_400_000) + 1) * 86_400_000 + 3 * 3_600_000;
    const s = Math.max(0, Math.floor((next - now) / 1000));
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  }
}
