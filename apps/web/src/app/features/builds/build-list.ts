import { Component, computed, inject, input } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, combineLatest, map, of, startWith, switchMap } from 'rxjs';

import { BuildCard as Build, BuildsService } from '../../core/services/builds.service';
import { HeroesService } from '../../core/services/heroes.service';
import { NamePreferenceService } from '../../core/services/name-preference.service';
import { AuthService } from '../../core/services/auth.service';
import { BuildCard } from '../../shared/build-card/build-card';

type State = { status: 'loading' } | { status: 'error' } | { status: 'ok'; total: number; page: number; builds: Build[] };

const PAGE = 24;

/** /builds?heroi=haze&ordem=novas&pagina=2 */
@Component({
  selector: 'app-build-list',
  imports: [RouterLink, BuildCard],
  template: `
    <section class="container page">
      <header class="head">
        <div>
          <p class="kicker">Comunidade</p>
          <h1>Builds</h1>
          <p class="sub">Builds de itens montadas pela comunidade. Vote nas que funcionam.</p>
        </div>
        <div class="actions">
          @if (auth.user()) {
            <a class="btn btn--ghost" routerLink="/builds/minhas">Minhas builds</a>
            <a class="btn" routerLink="/builds/nova" [queryParams]="{ heroi: hero() }">Criar build</a>
          } @else if (auth.user() === null) {
            <a class="btn" [href]="auth.steamLoginUrl('/builds/nova')">Entrar para criar</a>
          }
        </div>
      </header>

      <div class="filters">
        <label>
          <span>Herói</span>
          <select [value]="hero() ?? ''" (change)="go({ heroi: $any($event.target).value || null, pagina: null })">
            <option value="">Todos os heróis</option>
            @for (h of heroes(); track h.slug) {
              <option [value]="h.slug">{{ names.primary(h.name, h.name_en) }}</option>
            }
          </select>
        </label>
        <div class="chips" role="group" aria-label="Ordem">
          <button type="button" [class.active]="sort() === 'top'" (click)="go({ ordem: null, pagina: null })">Mais votadas</button>
          <button type="button" [class.active]="sort() === 'novas'" (click)="go({ ordem: 'novas', pagina: null })">Mais novas</button>
        </div>
      </div>

      @switch (state().status) {
        @case ('loading') {
          <p class="muted">Carregando builds…</p>
        }
        @case ('error') {
          <p class="muted">Não deu para carregar as builds agora.</p>
        }
        @case ('ok') {
          @if (!list().length) {
            <div class="empty">
              <p>Nenhuma build {{ hero() ? 'para esse herói ' : '' }}ainda. Que tal ser a primeira pessoa?</p>
              <a class="btn" routerLink="/builds/nova" [queryParams]="{ heroi: hero() }">Criar build</a>
            </div>
          } @else {
            <div class="grid">
              @for (b of list(); track b.id) {
                <app-build-card [build]="b" />
              }
            </div>
            @if (pages() > 1) {
              <nav class="pager" aria-label="Páginas">
                <button type="button" [disabled]="page() <= 1" (click)="go({ pagina: page() - 1 })">« Anterior</button>
                <span>Página {{ page() }} de {{ pages() }}</span>
                <button type="button" [disabled]="page() >= pages()" (click)="go({ pagina: page() + 1 })">Próxima »</button>
              </nav>
            }
          }
        }
      }
    </section>
  `,
  styleUrl: './builds.scss',
})
export class BuildList {
  private readonly builds = inject(BuildsService);
  private readonly router = inject(Router);
  protected readonly auth = inject(AuthService);
  protected readonly names = inject(NamePreferenceService);

  readonly heroi = input<string | undefined>();
  readonly ordem = input<string | undefined>();
  readonly pagina = input<string | undefined>();

  protected readonly hero = computed(() => this.heroi() || null);
  protected readonly sort = computed<'top' | 'novas'>(() => (this.ordem() === 'novas' ? 'novas' : 'top'));
  protected readonly page = computed(() => Math.max(Number.parseInt(this.pagina() ?? '1', 10) || 1, 1));

  protected readonly heroes = toSignal(
    inject(HeroesService)
      .list()
      .pipe(
        map((hs) => [...hs].sort((a, b) => this.names.primary(a.name, a.name_en).localeCompare(this.names.primary(b.name, b.name_en), 'pt-BR'))),
        catchError(() => of([])),
      ),
    { initialValue: [] },
  );

  protected readonly state = toSignal(
    combineLatest([toObservable(this.hero), toObservable(this.sort), toObservable(this.page)]).pipe(
      switchMap(([h, s, p]) =>
        this.builds.list(h, s, p).pipe(
          map((r): State => ({ status: 'ok', total: r.total, page: r.page, builds: r.builds })),
          catchError(() => of<State>({ status: 'error' })),
          startWith<State>({ status: 'loading' }),
        ),
      ),
    ),
    { initialValue: { status: 'loading' } as State },
  );

  protected readonly list = computed(() => {
    const s = this.state();
    return s.status === 'ok' ? s.builds : [];
  });
  protected readonly pages = computed(() => {
    const s = this.state();
    return s.status === 'ok' ? Math.ceil(s.total / PAGE) : 0;
  });

  protected go(params: Record<string, string | number | null>): void {
    void this.router.navigate([], { queryParams: params, queryParamsHandling: 'merge' });
  }
}
