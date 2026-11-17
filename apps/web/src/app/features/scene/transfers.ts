import { Component, computed, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, startWith } from 'rxjs';

import { SceneService } from '../../core/services/scene.service';
import { TransferEvent, initials } from '../../core/models/scene.models';

type LoadState = { status: 'loading' } | { status: 'error' } | { status: 'ok'; events: TransferEvent[] };

@Component({
  selector: 'app-transfers',
  imports: [RouterLink, DatePipe],
  templateUrl: './transfers.html',
  styleUrl: './transfers.scss',
})
export class Transfers {
  protected readonly initials = initials;

  protected readonly state = toSignal(
    inject(SceneService)
      .transfers(150)
      .pipe(
        map((events): LoadState => ({ status: 'ok', events })),
        catchError(() => of<LoadState>({ status: 'error' })),
        startWith<LoadState>({ status: 'loading' }),
      ),
    { requireSync: true },
  );

  protected readonly events = computed(() => {
    const s = this.state();
    return s.status === 'ok' ? s.events : [];
  });
}