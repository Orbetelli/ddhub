import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { API_BASE_URL } from '../api.config';
import { Creator } from '../models/creator.models';

@Injectable({ providedIn: 'root' })
export class CreatorsService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_BASE_URL);

  list(): Observable<Creator[]> {
    return this.http.get<Creator[]>(`${this.api}/creators`);
  }
}