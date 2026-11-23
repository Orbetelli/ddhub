import { Component, computed, inject, input } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, startWith, switchMap } from 'rxjs';

import { SceneService } from '../../core/services/scene.service';
import { TeamDetail as Team, initials, socialLinks } from '../../core/models/scene.models';
import { Markdown } from '../../shared/markdown/markdown';
import { MatchRow } from '../../shared/match-row/match-row';
import { MatchCard } from '../../core/models/scene.models';

type LoadState = { status: 'loading' } | { status: 'not-found' } | { status: 'error' } | { status: 'ok'; team: Team };

@Component({
  selector: 'app-team-detail',
  imports: [RouterLink, DatePipe, Markdown, MatchRow],
  templateUrl: './team-detail.html',
  styleUrl: './team-detail.scss',
})
export class TeamDetail {
  /** Vem da rota /times/:slug */
  readonly slug = input.required<string>();

  protected readonly initials = initials;
  private readonly scene = inject(SceneService);

  protected readonly state = toSignal(
    toObservable(this.slug).pipe(
      switchMap((slug) =>
        this.scene.team(slug).pipe(
          map((team): LoadState => ({ status: 'ok', team })),
          catchError((err: HttpErrorResponse) =>
            of<LoadState>({ status: err.status === 404 || err.status === 400 ? 'not-found' : 'error' }),
          ),
          startWith<LoadState>({ status: 'loading' }),
        ),
      ),
    ),
    { initialValue: { status: 'loading' } as LoadState },
  );

  /** Últimas partidas do time (ao vivo e próximas aparecem primeiro). */
  protected readonly matches = toSignal(
    toObservable(this.slug).pipe(
      switchMap((slug) => this.scene.matches({ team: slug, limit: 10 }).pipe(catchError(() => of<MatchCard[]>([])))),
      map((list) =>
        [...list].sort(
          (a, b) =>
            Number(b.status !== 'finished') - Number(a.status !== 'finished') || b.scheduled_at.localeCompare(a.scheduled_at),
        ),
      ),
    ),
    { initialValue: [] as MatchCard[] },
  );

  protected readonly team = computed(() => {
    const s = this.state();
    return s.status === 'ok' ? s.team : null;
  });

  protected readonly links = computed(() => {
    const t = this.team();
    return t ? socialLinks(t) : [];
  });
}
