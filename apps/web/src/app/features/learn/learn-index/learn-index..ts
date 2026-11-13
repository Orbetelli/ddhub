import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, startWith } from 'rxjs';

import { LearnService } from '../../../core/services/learn.service';
import { ChapterSummary } from '../../../core/models/learn.models';

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ok'; chapters: ChapterSummary[] };

/** /aprender — capa do guia com a lista de capítulos. */
@Component({
  selector: 'app-learn-index',
  imports: [RouterLink],
  templateUrl: './learn-index.html',
  styleUrl: './learn-index.scss',
})
export class LearnIndex {
  protected readonly state = toSignal(
    inject(LearnService)
      .list()
      .pipe(
        map((chapters): LoadState => ({ status: 'ok', chapters })),
        catchError(() => of<LoadState>({ status: 'error' })),
        startWith<LoadState>({ status: 'loading' }),
      ),
    { requireSync: true },
  );
}