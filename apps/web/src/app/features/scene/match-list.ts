import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, combineLatest, map, of, startWith } from 'rxjs';

import { SceneService } from '../../core/services/scene.service';
import { MatchCard } from '../../core/models/scene.models';
import { MatchRow } from '../../shared/match-row/match-row';

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ok'; upcoming: MatchCard[]; results: MatchCard[] };

@Component({
  selector: 'app-match-list',
  imports: [RouterLink, MatchRow],
  templateUrl: './match-list.html',
  styleUrl: './match-list.scss',
})
export class MatchList {
  private readonly scene = inject(SceneService);

  protected readonly state = toSignal(
    combineLatest([this.scene.matches({ status: 'upcoming', limit: 50 }), this.scene.matches({ status: 'results', limit: 100 })]).pipe(
      map(([upcoming, results]): LoadState => ({ status: 'ok', upcoming, results })),
      catchError(() => of<LoadState>({ status: 'error' })),
      startWith<LoadState>({ status: 'loading' }),
    ),
    { requireSync: true },
  );

  protected readonly live = computed(() => {
    const s = this.state();
    return s.status === 'ok' ? s.upcoming.filter((m) => m.status === 'live') : [];
  });

  protected readonly upcoming = computed(() => {
    const s = this.state();
    return s.status === 'ok' ? s.upcoming.filter((m) => m.status !== 'live') : [];
  });

  protected readonly results = computed(() => {
    const s = this.state();
    return s.status === 'ok' ? s.results : [];
  });
}
