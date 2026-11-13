import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, of, shareReplay } from 'rxjs';

import { API_BASE_URL } from '../api.config';
import { AssetRefs, EMPTY_REFS } from '../models/asset-refs.models';

/**
 * Nomes e imagens de heróis, itens, NPCs e imagens soltas,
 * usados pelos atalhos {{heroi:...}}, {{item:...}}, {{npc:...}}, {{imagem:...}} do guia.
 * Carregado uma vez e compartilhado por todas as telas.
 */
@Injectable({ providedIn: 'root' })
export class AssetRefsService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_BASE_URL);

  private readonly refs$ = this.http.get<AssetRefs>(`${this.api}/assets/refs`).pipe(
    catchError(() => of(EMPTY_REFS)),
    shareReplay(1),
  );

  readonly refs = toSignal(this.refs$, { initialValue: EMPTY_REFS });
}