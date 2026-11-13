import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, shareReplay } from 'rxjs';

import { API_BASE_URL } from '../api.config';
import { ItemDetail, ShopItem } from '../models/item.models';

@Injectable({ providedIn: 'root' })
export class ItemsService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_BASE_URL);

  /** A loja inteira é pequena: carrega uma vez e reaproveita entre as telas. */
  private readonly list$ = this.http.get<ShopItem[]>(`${this.api}/items`).pipe(shareReplay(1));

  list(): Observable<ShopItem[]> {
    return this.list$;
  }

  get(slug: string): Observable<ItemDetail> {
    return this.http.get<ItemDetail>(`${this.api}/items/${encodeURIComponent(slug)}`);
  }
}