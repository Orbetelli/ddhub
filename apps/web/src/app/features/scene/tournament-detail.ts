import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, startWith, switchMap } from 'rxjs';

import { SceneService } from '../../core/services/scene.service';
import {
  MatchCard,
  TOURNAMENT_STATUS_LABEL,
  TournamentDetail as Tournament,
  dateRange,
  initials,
  usd,
} from '../../core/models/scene.models';
import { Markdown } from '../../shared/markdown/markdown';
import { MatchRow } from '../../shared/match-row/match-row';

type LoadState = { status: 'loading' } | { status: 'not-found' } | { status: 'error' } | { status: 'ok'; t: Tournament };

interface MatchDay {
  label: string;
  matches: MatchCard[];
}

@Component({
  selector: 'app-tournament-detail',
  imports: [RouterLink, Markdown, MatchRow],
  templateUrl: './tournament-detail.html',
  styleUrl: './tournament-detail.scss',
})
export class TournamentDetail {
  /** Vem da rota /torneios/:slug */
  readonly slug = input.required<string>();

  protected readonly initials = initials;
  protected readonly dateRange = dateRange;
  protected readonly usd = usd;
  protected readonly statusLabel = TOURNAMENT_STATUS_LABEL;
  private readonly scene = inject(SceneService);

  protected readonly state = toSignal(
    toObservable(this.slug).pipe(
      switchMap((slug) =>
        this.scene.tournament(slug).pipe(
          map((t): LoadState => ({ status: 'ok', t })),
          catchError((err: HttpErrorResponse) =>
            of<LoadState>({ status: err.status === 404 || err.status === 400 ? 'not-found' : 'error' }),
          ),
          startWith<LoadState>({ status: 'loading' }),
        ),
      ),
    ),
    { initialValue: { status: 'loading' } as LoadState },
  );

  protected readonly tournament = computed(() => {
    const s = this.state();
    return s.status === 'ok' ? s.t : null;
  });

  /** Partidas agrupadas por dia, na ordem do torneio. */
  protected readonly days = computed<MatchDay[]>(() => {
    const t = this.tournament();
    if (!t) return [];
    const out = new Map<string, MatchCard[]>();
    for (const m of t.matches) {
      const label = new Date(m.scheduled_at).toLocaleDateString('pt-BR', {
        weekday: 'long',
        day: '2-digit',
        month: 'long',
        timeZone: 'America/Sao_Paulo',
      });
      out.set(label, [...(out.get(label) ?? []), m]);
    }
    return [...out].map(([label, matches]) => ({ label, matches }));
  });

  /** Medalha para as 3 primeiras colocações. */
  protected medal(place: string): string {
    return place === '1' ? 'gold' : place === '2' ? 'silver' : place === '3' || place === '3-4' ? 'bronze' : '';
  }
}
