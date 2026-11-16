import { Injectable, PLATFORM_ID, computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, of, shareReplay, switchMap, timer } from 'rxjs';

import { API_BASE_URL } from '../api.config';
import { EMPTY_LIVE, LiveSnapshot } from '../models/live.models';

/** O navegador pergunta à nossa API a cada 1 minuto (a API pergunta à Twitch a cada 2). */
const POLL_MS = 60_000;

/** Quem está ao vivo agora. Compartilhado entre a página de Criadores e a home. */
@Injectable({ providedIn: 'root' })
export class LiveService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_BASE_URL);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private readonly fetch$ = () =>
    this.http.get<LiveSnapshot>(`${this.api}/live`).pipe(catchError(() => of(EMPTY_LIVE)));

  private readonly live$ = (this.isBrowser ? timer(0, POLL_MS).pipe(switchMap(() => this.fetch$())) : this.fetch$()).pipe(
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  readonly snapshot = toSignal(this.live$, { initialValue: EMPTY_LIVE });

  /** Slugs dos criadores ao vivo, para o selo "AO VIVO" nos cards. */
  readonly liveSlugs = computed(() => new Set(this.snapshot().streams.map((s) => s.slug)));
}
