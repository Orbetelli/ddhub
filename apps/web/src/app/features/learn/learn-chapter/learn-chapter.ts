import { Component, computed, inject, input } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, startWith, switchMap } from 'rxjs';

import { LearnService } from '../../../core/services/learn.service';
import { Chapter, ChapterSummary } from '../../../core/models/learn.models';
import { Markdown } from '../../../shared/markdown/markdown';

type LoadState =
  | { status: 'loading' }
  | { status: 'not-found' }
  | { status: 'error' }
  | { status: 'ok'; chapter: Chapter };

/** /aprender/:slug — um capítulo, com índice lateral e anterior/próximo. */
@Component({
  selector: 'app-learn-chapter',
  imports: [RouterLink, DatePipe, Markdown],
  templateUrl: './learn-chapter.html',
  styleUrl: './learn-chapter.scss',
})
export class LearnChapter {
  /** Vem do parâmetro da rota (withComponentInputBinding). */
  readonly slug = input.required<string>();

  private readonly learn = inject(LearnService);

  /** Índice lateral: carregado uma vez. */
  protected readonly toc = toSignal(this.learn.list().pipe(catchError(() => of<ChapterSummary[]>([]))), {
    initialValue: [] as ChapterSummary[],
  });

  protected readonly state = toSignal(
    toObservable(this.slug).pipe(
      switchMap((slug) =>
        this.learn.get(slug).pipe(
          map((chapter): LoadState => ({ status: 'ok', chapter })),
          catchError((err: HttpErrorResponse) =>
            of<LoadState>({ status: err.status === 404 || err.status === 400 ? 'not-found' : 'error' }),
          ),
          startWith<LoadState>({ status: 'loading' }),
        ),
      ),
    ),
    { initialValue: { status: 'loading' } as LoadState },
  );

  protected readonly chapter = computed(() => {
    const s = this.state();
    return s.status === 'ok' ? s.chapter : null;
  });
}