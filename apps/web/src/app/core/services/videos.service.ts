import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, map, of } from 'rxjs';

import { API_BASE_URL } from '../api.config';

export interface Video {
  id: string;
  title: string;
  url: string;
  thumbnail: string;
  published_at: string;
  creator: { slug: string; name: string; avatar_url: string | null };
}

@Injectable({ providedIn: 'root' })
export class VideosService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_BASE_URL);

  /** Últimos vídeos de Deadlock dos criadores BR (vazio se a API falhar). */
  list(limit = 24): Observable<Video[]> {
    return this.http.get<{ videos: Video[] }>(`${this.api}/videos?limit=${limit}`).pipe(
      map((r) => r.videos ?? []),
      catchError(() => of<Video[]>([])),
    );
  }
}
