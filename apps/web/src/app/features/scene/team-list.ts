import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, startWith } from 'rxjs';

import { SceneService } from '../../core/services/scene.service';
import { TeamCard, initials } from '../../core/models/scene.models';

type LoadState = { status: 'loading' } | { status: 'error' } | { status: 'ok'; teams: TeamCard[] };

@Component({
  selector: 'app-team-list',
  imports: [RouterLink],
  templateUrl: './team-list.html',
  styleUrl: './team-list.scss',
})
export class TeamList {
  protected readonly initials = initials;
  protected readonly ghosts = [1, 2, 3, 4];

  protected readonly state = toSignal(
    inject(SceneService)
      .teams()
      .pipe(
        map((teams): LoadState => ({ status: 'ok', teams })),
        catchError(() => of<LoadState>({ status: 'error' })),
        startWith<LoadState>({ status: 'loading' }),
      ),
    { requireSync: true },
  );

  protected readonly active = computed(() => {
    const s = this.state();
    return s.status === 'ok' ? s.teams.filter((t) => t.is_active) : [];
  });

  protected readonly inactive = computed(() => {
    const s = this.state();
    return s.status === 'ok' ? s.teams.filter((t) => !t.is_active) : [];
  });
}