import { Component, computed, inject, output, signal, OnInit } from '@angular/core';

import { DailyService, MapGuessResult, MapPuzzle } from '../../core/services/daily.service';
import { loadProgress, loadStats, recordResult, saveProgress, Stats } from './daily-store';

interface Guess {
  x: number;
  y: number;
  correct: boolean;
  closeness: string;
  direction: string | null;
}

interface Progress {
  guesses: Guess[];
  answer: MapGuessResult['answer'];
}

/** Zoom do recorte por número de erros (abre a cada erro). */
const ZOOM = [6, 4.5, 3.3, 2.4, 1.8];

/** "Onde fica?": mostra um pedaço do mapa e a pessoa clica no lugar certo do mapa inteiro. */
@Component({
  selector: 'app-map-game',
  template: `
    @if (error()) {
      <p class="state">O desafio não carregou. Tente de novo em alguns segundos (a API pode estar acordando).</p>
    } @else if (!puzzle()) {
      <p class="state">Carregando o mapa…</p>
    } @else {
      @let p = puzzle()!;
      <div class="layout">
        <div class="side">
          <div class="crop" [style.background-image]="'url(' + p.map_image + ')'" [style.background-size]="cropSize()" [style.background-position]="cropPos()">
            <span class="cross" aria-hidden="true"></span>
          </div>
          <p class="tries">Tentativa {{ Math.min(guesses().length + 1, p.max_guesses) }} de {{ p.max_guesses }}</p>

          @if (guesses().length) {
            <ol class="guesses">
              @for (g of guesses(); track $index) {
                <li [class.ok]="g.correct">
                  {{ g.correct ? '🟩' : '🟥' }} {{ g.closeness }}
                  @if (g.direction) {
                    · vá para o {{ g.direction }}
                  }
                </li>
              }
            </ol>
          }

          @if (answer(); as a) {
            <div class="result" [class.win]="won()">
              <strong>{{ won() ? 'Acertou!' : 'Não foi dessa vez.' }}</strong>
              <span>O lugar era: {{ a.label }}</span>
              <span class="stats">Jogos {{ stats().played }} · Sequência {{ stats().streak }} · Melhor {{ stats().best }}</span>
            </div>
          } @else {
            <button class="confirm" type="button" [disabled]="!pending() || sending()" (click)="send()">
              {{ pending() ? 'Confirmar palpite' : 'Clique no mapa para marcar' }}
            </button>
          }
        </div>

        <div class="full" (click)="mark($event)" [class.locked]="finished()">
          <img [src]="p.map_image" alt="Mapa do Deadlock" draggable="false" />
          @for (g of guesses(); track $index) {
            <span class="pin" [class.ok]="g.correct" [style.left.%]="g.x * 100" [style.top.%]="g.y * 100">{{ $index + 1 }}</span>
          }
          @if (pending(); as pt) {
            <span class="pin pin--pending" [style.left.%]="pt.x * 100" [style.top.%]="pt.y * 100"></span>
          }
          @if (answer(); as a) {
            <span class="pin pin--answer" [style.left.%]="a.x * 100" [style.top.%]="a.y * 100">★</span>
          }
        </div>
      </div>
    }
  `,
  styles: `
    :host { display: block; }
    .state { color: var(--muted); padding: 24px 0; }
    .layout { display: grid; grid-template-columns: 240px 1fr; gap: 20px; align-items: start; }
    @media (max-width: 720px) { .layout { grid-template-columns: 1fr; } }
    .side { display: flex; flex-direction: column; gap: 10px; }
    .crop {
      position: relative; width: 100%; aspect-ratio: 1; border-radius: 14px; border: 1px solid var(--border);
      background-color: var(--bg-deep); background-repeat: no-repeat; transition: background-size .5s ease, background-position .5s ease;
    }
    .cross { position: absolute; left: 50%; top: 50%; width: 14px; height: 14px; margin: -7px; border: 2px solid var(--accent); border-radius: 50%; }
    .tries { font-size: 13px; color: var(--muted); margin: 0; }
    .guesses { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; font-size: 14px; }
    .guesses li { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 6px 10px; }
    .guesses li.ok { border-color: var(--win); }
    .confirm {
      padding: 11px 14px; border-radius: 10px; border: 0; background: var(--accent); color: var(--bg-deep);
      font: inherit; font-weight: 700; cursor: pointer;
    }
    .confirm:disabled { opacity: .5; cursor: default; }
    .result { display: flex; flex-direction: column; gap: 4px; padding: 12px 14px; border-radius: 12px; background: var(--surface); border: 1px solid var(--live); }
    .result.win { border-color: var(--win); }
    .result strong { font-family: var(--font-display); font-size: 18px; color: var(--text-strong); }
    .result .stats { font-size: 13px; color: var(--muted); }
    .full { position: relative; border-radius: 14px; overflow: hidden; border: 1px solid var(--border); cursor: crosshair; background: var(--bg-deep); }
    .full.locked { cursor: default; }
    .full img { display: block; width: 100%; height: auto; user-select: none; }
    .pin {
      position: absolute; transform: translate(-50%, -50%); width: 20px; height: 20px; border-radius: 50%;
      display: grid; place-items: center; font-size: 11px; font-weight: 700;
      background: var(--live); color: #fff; border: 2px solid #fff; pointer-events: none;
    }
    .pin.ok { background: var(--win); }
    .pin--pending { background: var(--accent); }
    .pin--answer { width: 26px; height: 26px; background: var(--win); font-size: 14px; }
  `,
})
export class MapGame implements OnInit {
  private readonly daily = inject(DailyService);
  protected readonly Math = Math;

  readonly finishedChange = output<void>();

  protected readonly puzzle = signal<MapPuzzle | null>(null);
  protected readonly error = signal(false);
  protected readonly guesses = signal<Guess[]>([]);
  protected readonly answer = signal<MapGuessResult['answer']>(null);
  protected readonly pending = signal<{ x: number; y: number } | null>(null);
  protected readonly sending = signal(false);
  protected readonly stats = signal<Stats>(loadStats('mapa'));

  protected readonly wrong = computed(() => this.guesses().filter((g) => !g.correct).length);
  protected readonly won = computed(() => this.guesses().some((g) => g.correct));
  protected readonly finished = computed(() => this.won() || !!this.answer());

  private readonly zoomLevel = computed(() => (this.finished() ? 1.6 : ZOOM[Math.min(this.wrong(), ZOOM.length - 1)]));

  protected readonly cropSize = computed(() => `${this.zoomLevel() * 100}%`);

  /** Posição do fundo para o ponto do desafio ficar no centro do recorte. */
  protected readonly cropPos = computed(() => {
    const f = this.puzzle()?.focus ?? { x: 0.5, y: 0.5 };
    const z = this.zoomLevel();
    const pos = (c: number) => Math.min(Math.max((0.5 - c * z) / (1 - z), 0), 1) * 100;
    return `${pos(f.x)}% ${pos(f.y)}%`;
  });

  ngOnInit(): void {
    this.daily.map().subscribe({
      next: (p) => {
        this.puzzle.set(p);
        const saved = loadProgress<Progress>('mapa', p.number);
        if (saved) {
          this.guesses.set(saved.guesses ?? []);
          this.answer.set(saved.answer ?? null);
        }
      },
      error: () => this.error.set(true),
    });
  }

  protected mark(ev: MouseEvent): void {
    if (this.finished() || this.sending()) return;
    const box = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const x = (ev.clientX - box.left) / box.width;
    const y = (ev.clientY - box.top) / box.height;
    if (x >= 0 && x <= 1 && y >= 0 && y <= 1) this.pending.set({ x, y });
  }

  protected send(): void {
    const p = this.puzzle();
    const pt = this.pending();
    if (!p || !pt || this.sending() || this.finished()) return;
    this.sending.set(true);
    this.daily.guessMap(pt.x, pt.y, this.wrong()).subscribe({
      next: (r) => {
        this.sending.set(false);
        this.pending.set(null);
        this.guesses.update((g) => [...g, { x: pt.x, y: pt.y, correct: r.correct, closeness: r.closeness, direction: r.direction }]);
        this.answer.set(r.answer);
        saveProgress('mapa', p.number, { guesses: this.guesses(), answer: this.answer() } satisfies Progress);
        if (r.answer) {
          this.stats.set(recordResult('mapa', p.number, r.correct));
          this.finishedChange.emit();
        }
      },
      error: () => this.sending.set(false),
    });
  }
}
