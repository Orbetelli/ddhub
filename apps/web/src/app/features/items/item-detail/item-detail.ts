import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, startWith, switchMap } from 'rxjs';

import { ItemsService } from '../../../core/services/items.service';
import { NamePreferenceService } from '../../../core/services/name-preference.service';
import { ItemDetail as ItemData, SLOT_LABEL } from '../../../core/models/item.models';
import { descriptionParagraphs, propertyLines } from '../../../core/utils/game-text';

type LoadState =
  | { status: 'loading' }
  | { status: 'not-found' }
  | { status: 'error' }
  | { status: 'ok'; item: ItemData };

@Component({
  selector: 'app-item-detail',
  imports: [RouterLink],
  templateUrl: './item-detail.html',
  styleUrl: './item-detail.scss',
})
export class ItemDetail {
  /** Vem do parâmetro da rota /itens/:slug (withComponentInputBinding). */
  readonly slug = input.required<string>();

  protected readonly names = inject(NamePreferenceService);
  protected readonly slotLabel = SLOT_LABEL;
  private readonly items = inject(ItemsService);

  protected readonly state = toSignal(
    toObservable(this.slug).pipe(
      switchMap((slug) =>
        this.items.get(slug).pipe(
          map((item): LoadState => ({ status: 'ok', item })),
          catchError((err: HttpErrorResponse) =>
            of<LoadState>({ status: err.status === 404 || err.status === 400 ? 'not-found' : 'error' }),
          ),
          startWith<LoadState>({ status: 'loading' }),
        ),
      ),
    ),
    { initialValue: { status: 'loading' } as LoadState },
  );

  protected readonly item = computed(() => {
    const s = this.state();
    return s.status === 'ok' ? s.item : null;
  });

  /** Descrição oficial em PT (o seletor PT/EN só troca os nomes). */
  protected readonly paragraphs = computed(() => descriptionParagraphs(this.item()?.description));

  protected readonly stats = computed(() => propertyLines(this.item()?.properties));
}