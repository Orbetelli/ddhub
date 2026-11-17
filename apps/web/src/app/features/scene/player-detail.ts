import { Component, computed, inject, input } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, startWith, switchMap } from 'rxjs';

import { SceneService } from '../../core/services/scene.service';
import { PlayerDetail as Player, initials, socialLinks } from '../../core/models/scene.models';
import { Markdown } from '../../shared/markdown/markdown';

type LoadState = { status: 'loading' } | { status: 'not-found' } | { status: 'error' } | { status: 'ok'; player: Player };

@Component({
  selector: 'app-player-detail',
  imports: [RouterLink, DatePipe, Markdown],
  templateUrl: './player-detail.html',
  styleUrl: './player-detail.scss',
})
export class PlayerDetail {
  /** Vem da rota /jogadores/:slug */
  readonly slug = input.required<string>();

  protected readonly initials = initials;
  private readonly scene = inject(SceneService);

  protected readonly state = toSignal(
    toObservable(this.slug).pipe(
      switchMap((slug) =>
        this.scene.player(slug).pipe(
          map((player): LoadState => ({ status: 'ok', player })),
          catchError((err: HttpErrorResponse) =>
            of<LoadState>({ status: err.status === 404 || err.status === 400 ? 'not-found' : 'error' }),
          ),
          startWith<LoadState>({ status: 'loading' }),
        ),
      ),
    ),
    { initialValue: { status: 'loading' } as LoadState },
  );

  protected readonly player = computed(() => {
    const s = this.state();
    return s.status === 'ok' ? s.player : null;
  });

  protected readonly links = computed(() => {
    const p = this.player();
    return p ? socialLinks(p) : [];
  });
}