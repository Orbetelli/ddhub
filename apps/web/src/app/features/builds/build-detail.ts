import { Component, computed, inject, input, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, startWith, switchMap } from 'rxjs';

import { BuildDetail as Build, BuildsService, PHASE_LABEL } from '../../core/services/builds.service';
import { AuthService } from '../../core/services/auth.service';
import { apiError } from '../../core/services/account.service';

type State = { status: 'loading' } | { status: 'missing' } | { status: 'ok'; build: Build };

/** /builds/:id */
@Component({
  selector: 'app-build-detail',
  imports: [DatePipe, DecimalPipe, RouterLink],
  template: `
    <section class="container page">
      @switch (state().status) {
        @case ('loading') {
          <p class="muted">Carregando build…</p>
        }
        @case ('missing') {
          <h1>Build não encontrada</h1>
          <p class="muted">Ela pode ter sido apagada ou ainda ser um rascunho.</p>
          <a routerLink="/builds">Ver outras builds</a>
        }
        @case ('ok') {
          @let b = build()!;
          <a class="back" routerLink="/builds" [queryParams]="{ heroi: b.hero?.slug }">« Builds{{ b.hero ? ' de ' + b.hero.name : '' }}</a>
          <header class="head detail-head">
            <div class="who">
              @if (b.hero?.image) {
                <a [routerLink]="['/herois', b.hero!.slug]"><img class="hero" [src]="b.hero!.image" [alt]="b.hero!.name" width="72" height="72" /></a>
              }
              <div>
                <h1>{{ b.title }}</h1>
                <p class="muted">
                  {{ b.hero?.name }}
                  @if (b.author) {
                    · por <a [routerLink]="['/u', b.author.username]">{{ b.author.display_name }}</a>
                  }
                  · atualizada em {{ b.updated_at | date: 'dd/MM/yyyy' }}
                </p>
                <div class="tags">
                  @if (!b.published) {
                    <span class="tag tag--draft">Rascunho: só você vê</span>
                  }
                  @if (b.outdated) {
                    <span class="tag">Feita antes do último patch: confira se ainda vale</span>
                  }
                </div>
              </div>
            </div>
            <div class="vote" aria-label="Votos">
              <button type="button" [class.on]="myVote() === 1" [disabled]="!canVote() || voting()" (click)="vote(1)" title="Boa build">▲</button>
              <strong [class.neg]="score() < 0">{{ score() }}</strong>
              <button type="button" [class.on]="myVote() === -1" [disabled]="!canVote() || voting()" (click)="vote(-1)" title="Não curti">▼</button>
              @if (voteHint(); as hint) {
                <small>{{ hint }}</small>
              }
            </div>
          </header>

          <div class="phases">
            @for (p of b.phases; track p.phase) {
              @if (p.items.length) {
                <section class="phase">
                  <header>
                    <h2>{{ phaseLabel[p.phase] }}</h2>
                    <span class="cost">{{ p.cost | number: '1.0-0' }} almas</span>
                  </header>
                  <ol>
                    @for (i of p.items; track i.slug) {
                      <li>
                        <a [routerLink]="['/itens', i.slug]" [class]="'item slot-' + i.slot">
                          <img [src]="i.image_url" alt="" width="44" height="44" loading="lazy" />
                          <span class="item__text">
                            <strong>{{ i.name }}</strong>
                            <small>Tier {{ i.tier }} · {{ i.cost | number: '1.0-0' }}</small>
                            @if (i.note) {
                              <em>{{ i.note }}</em>
                            }
                          </span>
                        </a>
                      </li>
                    }
                  </ol>
                </section>
              }
            }
          </div>

          @if (b.description) {
            <section class="desc">
              <h2>Como jogar com essa build</h2>
              <p>{{ b.description }}</p>
            </section>
          }

          <div class="actions">
            <button type="button" class="btn btn--ghost" (click)="copyLink()">{{ copied() ? 'Link copiado!' : 'Copiar link' }}</button>
            @if (b.can_edit) {
              <a class="btn btn--ghost" [routerLink]="['/builds', b.id, 'editar']">Editar</a>
            }
            @if (b.can_delete) {
              <button type="button" class="btn btn--danger" (click)="remove()" [disabled]="deleting()">
                {{ confirmDelete() ? 'Clique de novo para apagar' : 'Apagar' }}
              </button>
            }
            @if (error(); as e) {
              <span class="msg" role="alert">{{ e }}</span>
            }
          </div>
          <p class="muted small">Itens e imagens do jogo via Deadlock API · Deadlock é marca da Valve.</p>
        }
      }
    </section>
  `,
  styleUrl: './builds.scss',
  styles: `
    .back { font-size: 14px; }
    .detail-head { align-items: flex-start; }
    .who { display: flex; gap: 16px; align-items: flex-start; min-width: 0; }
    .hero { width: 72px; height: 72px; border-radius: 4px; object-fit: cover; border: 2px solid var(--accent); }
    .who p { margin: 0; }
    .tags { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
    .tag { font-size: 12px; padding: 3px 8px; background: var(--surface-sub); color: var(--muted); }
    .tag--draft { background: var(--accent-soft); color: var(--text-strong); }
    .vote { display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 72px; }
    .vote button { width: 40px; height: 32px; border: 1px solid var(--border); background: var(--surface); color: var(--muted); cursor: pointer; font-size: 14px; }
    .vote button.on { border-color: var(--accent); color: var(--accent); }
    .vote button:disabled { cursor: default; opacity: .6; }
    .vote strong { font-family: var(--font-display); font-size: 24px; color: var(--win); }
    .vote strong.neg { color: var(--live); }
    .vote small { font-size: 11px; color: var(--muted); text-align: center; max-width: 120px; }
    .phases { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
    .phase { background: var(--surface); border: 1px solid var(--border); padding: 14px; }
    .phase header { display: flex; justify-content: space-between; align-items: baseline; }
    .cost { font-size: 13px; color: var(--muted); }
    .phase ol { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .item { display: flex; gap: 10px; align-items: flex-start; color: var(--text); text-decoration: none; }
    .item img { width: 44px; height: 44px; border-radius: 4px; background: var(--bg-deep); border-bottom: 3px solid transparent; flex: none; }
    .slot-weapon img { border-color: #e8913a; }
    .slot-vitality img { border-color: #6fbf4a; }
    .slot-spirit img { border-color: #a46cd8; }
    .item__text { display: flex; flex-direction: column; min-width: 0; }
    .item__text strong { color: var(--text-strong); }
    .item__text small { font-size: 12px; color: var(--muted); }
    .item__text em { font-size: 13px; color: var(--text); font-style: normal; margin-top: 2px; }
    .item:hover strong { color: var(--accent); }
    .desc { background: var(--surface); border: 1px solid var(--border); padding: 16px; }
    .desc p { margin: 0; white-space: pre-line; overflow-wrap: anywhere; }
  `,
})
export class BuildDetail {
  private readonly builds = inject(BuildsService);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  readonly id = input.required<string>();

  protected readonly phaseLabel = PHASE_LABEL;
  protected readonly voting = signal(false);
  protected readonly deleting = signal(false);
  protected readonly confirmDelete = signal(false);
  protected readonly copied = signal(false);
  protected readonly error = signal<string | null>(null);
  /** Placar e voto depois de votar (sem recarregar a build) */
  private readonly override = signal<{ score: number; my_vote: number } | null>(null);

  protected readonly state = toSignal(
    toObservable(this.id).pipe(
      switchMap((id) =>
        this.builds.get(id).pipe(
          map((build): State => ({ status: 'ok', build })),
          catchError(() => of<State>({ status: 'missing' })),
          startWith<State>({ status: 'loading' }),
        ),
      ),
    ),
    { initialValue: { status: 'loading' } as State },
  );

  protected readonly build = computed(() => {
    const s = this.state();
    return s.status === 'ok' ? s.build : null;
  });
  protected readonly score = computed(() => this.override()?.score ?? this.build()?.score ?? 0);
  protected readonly myVote = computed(() => this.override()?.my_vote ?? this.build()?.my_vote ?? 0);
  protected readonly canVote = computed(() => {
    const b = this.build();
    const me = this.auth.user();
    return !!b && !!me && b.published && !b.can_edit;
  });
  protected readonly voteHint = computed(() => {
    const b = this.build();
    if (!b || !b.published) return null;
    if (this.auth.user() === null) return 'Entre para votar';
    if (b.can_edit) return 'Sua build';
    return null;
  });

  protected async vote(v: 1 | -1): Promise<void> {
    const b = this.build();
    if (!b || this.voting()) return;
    this.voting.set(true);
    this.error.set(null);
    try {
      const next = this.myVote() === v ? 0 : v;
      this.override.set(await this.builds.vote(b.id, next));
    } catch (err) {
      this.error.set(apiError(err));
    } finally {
      this.voting.set(false);
    }
  }

  protected async remove(): Promise<void> {
    const b = this.build();
    if (!b || this.deleting()) return;
    if (!this.confirmDelete()) {
      this.confirmDelete.set(true);
      setTimeout(() => this.confirmDelete.set(false), 4000);
      return;
    }
    this.deleting.set(true);
    try {
      await this.builds.remove(b.id);
      await this.router.navigateByUrl('/builds/minhas');
    } catch (err) {
      this.error.set(apiError(err));
      this.deleting.set(false);
    }
  }

  protected async copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(location.href);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
      /* sem permissão */
    }
  }
}
