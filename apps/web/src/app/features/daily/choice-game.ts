import { Component, computed, inject, input, output, signal, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';

import {
  ChoiceMode,
  ChoicePuzzle,
  ChoiceReveal,
  DailyOption,
  DailyService,
} from '../../core/services/daily.service';
import { loadProgress, loadStats, norm, recordResult, saveProgress, Stats } from './daily-store';

interface Guess {
  slug: string;
  name: string;
  correct: boolean;
}

interface Progress {
  guesses: Guess[];
  hints: string[];
  answer: ChoiceReveal | null;
}

/** Zoom do item por número de erros (4× no começo, imagem inteira no fim). */
const ITEM_ZOOM = [4, 3.2, 2.5, 1.9, 1.4, 1.15];
/** Mob: silhueta preta que vai ganhando luz. */
const MOB_LIGHT = [0, 0, 0.12, 0.3, 0.55, 0.8];

/** Desafios de escolher da lista: Habilidade, Item e Mob. */
@Component({
  selector: 'app-choice-game',
  imports: [RouterLink],
  template: `
    @if (error()) {
      <p class="state">O desafio não carregou. Tente de novo em alguns segundos (a API pode estar acordando).</p>
    } @else if (!puzzle()) {
      <p class="state">Carregando o desafio…</p>
    } @else {
      @let p = puzzle()!;
      <div class="stage" [class.done]="finished()">
        <div class="frame" [class]="'frame frame--' + mode()">
          <img
            [src]="imageUrl()"
            alt="Imagem do desafio"
            draggable="false"
            [style.transform]="zoom()"
            [style.transform-origin]="origin()"
            [style.filter]="filter()"
          />
        </div>
        <p class="tries">Tentativa {{ Math.min(guesses().length + 1, p.max_guesses) }} de {{ p.max_guesses }}</p>
      </div>

      @if (hints().length) {
        <ul class="hints">
          @for (h of hints(); track h) {
            <li>💡 {{ h }}</li>
          }
        </ul>
      }

      @if (!finished()) {
        <div class="picker">
          <input
            type="text"
            [value]="query()"
            (input)="query.set($any($event.target).value)"
            (keydown.enter)="pickFirst()"
            [placeholder]="placeholder()"
            [disabled]="sending()"
            autocomplete="off"
            aria-label="Seu palpite"
          />
          @if (query().trim()) {
            <ul class="opts" role="listbox">
              @for (o of filtered(); track o.slug) {
                <li>
                  <button type="button" (click)="guess(o)" [disabled]="sending()">
                    @if (o.image) {
                      <img [src]="o.image" alt="" />
                    }
                    <span>{{ o.name }}</span>
                    @if (o.name_en && o.name_en !== o.name) {
                      <small>{{ o.name_en }}</small>
                    }
                  </button>
                </li>
              } @empty {
                <li class="none">Nada encontrado.</li>
              }
            </ul>
          }
        </div>
      }

      @if (guesses().length) {
        <ol class="guesses">
          @for (g of guesses(); track g.slug) {
            <li [class.ok]="g.correct">{{ g.correct ? '🟩' : '🟥' }} {{ g.name }}</li>
          }
        </ol>
      }

      @if (answer(); as a) {
        <div class="result" [class.win]="won()">
          <strong>{{ won() ? 'Acertou!' : 'Não foi dessa vez.' }}</strong>
          <span>
            Resposta: <a [routerLink]="a.link">{{ a.name }}</a>
            @if (a.detail) {
              · {{ a.detail }}
            }
          </span>
          <span class="stats">
            Jogos {{ stats().played }} · Vitórias {{ winRate() }}% · Sequência {{ stats().streak }} · Melhor {{ stats().best }}
          </span>
        </div>
      }
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 14px; }
    .state { color: var(--muted); padding: 24px 0; }
    .stage { display: flex; flex-direction: column; align-items: center; gap: 8px; }
    .frame {
      width: 160px; height: 160px; border-radius: 14px; overflow: hidden;
      background: var(--bg-deep); border: 1px solid var(--border);
      display: grid; place-items: center;
    }
    .frame img { width: 100%; height: 100%; object-fit: contain; transition: transform .5s ease, filter .5s ease; user-select: none; }
    .frame--habilidade img { padding: 18px; }
    .frame--mob { width: 220px; height: 220px; background: radial-gradient(circle, var(--surface-sub), var(--bg-deep)); }
    .tries { font-size: 13px; color: var(--muted); margin: 0; }
    .hints { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .hints li { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 8px 12px; font-size: 14px; }
    .picker { position: relative; }
    .picker input {
      width: 100%; padding: 12px 14px; border-radius: 10px; border: 1px solid var(--border);
      background: var(--surface); color: var(--text-strong); font: inherit; font-size: 15px;
    }
    .picker input:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
    .opts {
      position: absolute; z-index: 5; left: 0; right: 0; top: calc(100% + 4px); max-height: 260px; overflow: auto;
      list-style: none; margin: 0; padding: 4px; background: var(--surface-head); border: 1px solid var(--border); border-radius: 10px;
    }
    .opts button {
      width: 100%; display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: 0; border-radius: 8px;
      background: none; color: var(--text); font: inherit; text-align: left; cursor: pointer;
    }
    .opts button:hover, .opts li:first-child button { background: var(--surface-sub); }
    .opts img { width: 28px; height: 28px; border-radius: 6px; object-fit: cover; }
    .opts small { color: var(--muted); margin-left: auto; }
    .opts .none { padding: 8px 10px; color: var(--muted); }
    .guesses { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
    .guesses li { background: var(--surface); border: 1px solid var(--border); border-radius: 999px; padding: 4px 12px; font-size: 14px; }
    .guesses li.ok { border-color: var(--win); }
    .result {
      display: flex; flex-direction: column; gap: 4px; padding: 14px 16px; border-radius: 12px;
      background: var(--surface); border: 1px solid var(--live);
    }
    .result.win { border-color: var(--win); }
    .result strong { font-family: var(--font-display); font-size: 18px; color: var(--text-strong); }
    .result .stats { font-size: 13px; color: var(--muted); }
  `,
})
export class ChoiceGame implements OnInit {
  private readonly daily = inject(DailyService);
  protected readonly Math = Math;

  readonly mode = input.required<ChoiceMode>();
  /** Avisa a página quando o desafio termina (para atualizar abas e compartilhar). */
  readonly finishedChange = output<void>();

  protected readonly puzzle = signal<ChoicePuzzle | null>(null);
  protected readonly error = signal(false);
  protected readonly guesses = signal<Guess[]>([]);
  protected readonly hints = signal<string[]>([]);
  protected readonly answer = signal<ChoiceReveal | null>(null);
  protected readonly query = signal('');
  protected readonly sending = signal(false);
  protected readonly stats = signal<Stats>(loadStats('habilidade'));

  protected readonly wrong = computed(() => this.guesses().filter((g) => !g.correct).length);
  protected readonly won = computed(() => this.guesses().some((g) => g.correct));
  protected readonly finished = computed(() => this.won() || !!this.answer());
  protected readonly winRate = computed(() => (this.stats().played ? Math.round((this.stats().wins / this.stats().played) * 100) : 0));

  protected readonly placeholder = computed(() =>
    this.mode() === 'habilidade' ? 'Digite o nome do herói…' : this.mode() === 'item' ? 'Digite o nome do item…' : 'Digite o nome do mob…',
  );

  protected readonly imageUrl = computed(() => {
    const p = this.puzzle();
    return p ? `${this.daily.api}${p.image}` : '';
  });

  protected readonly zoom = computed(() => {
    if (this.mode() !== 'item' || this.finished()) return 'scale(1)';
    return `scale(${ITEM_ZOOM[Math.min(this.wrong(), ITEM_ZOOM.length - 1)]})`;
  });

  protected readonly origin = computed(() => {
    const f = this.puzzle()?.focus;
    return f ? `${f.x * 100}% ${f.y * 100}%` : '50% 50%';
  });

  protected readonly filter = computed(() => {
    if (this.mode() !== 'mob' || this.finished()) return 'none';
    return `brightness(${MOB_LIGHT[Math.min(this.wrong(), MOB_LIGHT.length - 1)]})`;
  });

  protected readonly filtered = computed<DailyOption[]>(() => {
    const q = norm(this.query());
    const used = new Set(this.guesses().map((g) => g.slug));
    if (!q) return [];
    return (this.puzzle()?.options ?? [])
      .filter((o) => !used.has(o.slug) && (norm(o.name).includes(q) || (o.name_en ? norm(o.name_en).includes(q) : false)))
      .sort((a, b) => Number(!norm(a.name).startsWith(q)) - Number(!norm(b.name).startsWith(q)))
      .slice(0, 8);
  });

  ngOnInit(): void {
    this.stats.set(loadStats(this.mode()));
    this.daily.choice(this.mode()).subscribe({
      next: (p) => {
        this.puzzle.set(p);
        const saved = loadProgress<Progress>(this.mode(), p.number);
        if (saved) {
          this.guesses.set(saved.guesses ?? []);
          this.hints.set(saved.hints ?? []);
          this.answer.set(saved.answer ?? null);
        }
      },
      error: () => this.error.set(true),
    });
  }

  protected pickFirst(): void {
    const first = this.filtered()[0];
    if (first) this.guess(first);
  }

  protected guess(o: DailyOption): void {
    const p = this.puzzle();
    if (!p || this.sending() || this.finished()) return;
    this.sending.set(true);
    this.daily.guessChoice(this.mode(), o.slug, this.wrong()).subscribe({
      next: (r) => {
        this.sending.set(false);
        this.query.set('');
        this.guesses.update((g) => [...g, { slug: o.slug, name: o.name, correct: r.correct }]);
        this.hints.set(r.hints);
        this.answer.set(r.answer);
        saveProgress(this.mode(), p.number, { guesses: this.guesses(), hints: this.hints(), answer: this.answer() } satisfies Progress);
        if (r.answer) {
          this.stats.set(recordResult(this.mode(), p.number, r.correct));
          this.finishedChange.emit();
        }
      },
      error: () => this.sending.set(false),
    });
  }
}
