import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { API_BASE_URL } from '../api.config';
import { MapData } from '../models/map.models';

@Injectable({ providedIn: 'root' })
export class MapService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_BASE_URL);

  get(): Observable<MapData> {
    return this.http.get<MapData>(`${this.api}/map`);
  }
}