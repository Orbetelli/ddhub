import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, startWith } from 'rxjs';

import { SceneService } from '../../core/services/scene.service';
import { TOURNAMENT_STATUS_LABEL, TournamentCard, dateRange, initials, usd } from '../../core/models/scene.models';

type LoadState = { status: 'loading' } | { status: 'error' } | { status: 'ok'; list: TournamentCard[] };

@Component({
  selector: 'app-tournament-list',
  imports: [RouterLink],
  templateUrl: './tournament-list.html',
  styleUrl: './tournament-list.scss',
})
export class TournamentList {
  protected readonly initials = initials;
  protected readonly dateRange = dateRange;
  protected readonly usd = usd;
  protected readonly statusLabel = TOURNAMENT_STATUS_LABEL;
  protected readonly ghosts = [1, 2, 3];

  protected readonly state = toSignal(
    inject(SceneService)
      .tournaments()
      .pipe(
        map((list): LoadState => ({ status: 'ok', list })),
        catchError(() => of<LoadState>({ status: 'error' })),
        startWith<LoadState>({ status: 'loading' }),
      ),
    { requireSync: true },
  );

  private readonly list = computed(() => {
    const s = this.state();
    return s.status === 'ok' ? s.list : [];
  });

  /** Em andamento e próximos primeiro; encerrados depois (mais recentes antes). */
  protected readonly groups = computed(() =>
    [
      { key: 'ongoing', label: 'Em andamento', items: this.list().filter((t) => t.status === 'ongoing') },
      {
        key: 'upcoming',
        label: 'Próximos',
        items: this.list()
          .filter((t) => t.status === 'upcoming')
          .sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at))),
      },
      { key: 'finished', label: 'Encerrados', items: this.list().filter((t) => t.status === 'finished') },
    ].filter((g) => g.items.length > 0),
  );
}
