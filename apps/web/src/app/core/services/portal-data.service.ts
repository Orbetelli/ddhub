import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';

import {
  Article,
  BuildSummary,
  ForumTopic,
  HeroStat,
  Match,
  Tournament,
  Transfer,
} from '../models/portal.models';
import {
  MOCK_ARTICLES,
  MOCK_BUILDS,
  MOCK_HEROES,
  MOCK_MATCHES,
  MOCK_TOPICS,
  MOCK_TOURNAMENTS,
  MOCK_TRANSFERS,
} from '../data/mock-data';

/**
 * Ponto único de acesso aos dados do portal.
 *
 * Hoje devolve dados de exemplo. Quando a API do NestJS existir, cada método
 * vira um `this.http.get<...>(`${API}/...`)` e as telas não mudam nada,
 * porque já consomem Observables.
 */
@Injectable({ providedIn: 'root' })
export class PortalDataService {
  getMatches(): Observable<Match[]> {
    return of(MOCK_MATCHES());
  }

  getTournaments(): Observable<Tournament[]> {
    return of(MOCK_TOURNAMENTS());
  }

  getLatestArticles(): Observable<Article[]> {
    return of(MOCK_ARTICLES());
  }

  getRecentTransfers(): Observable<Transfer[]> {
    return of(MOCK_TRANSFERS());
  }

  getHotTopics(): Observable<ForumTopic[]> {
    return of(MOCK_TOPICS());
  }

  getTopHeroes(): Observable<HeroStat[]> {
    return of(MOCK_HEROES());
  }

  getTopBuilds(): Observable<BuildSummary[]> {
    return of(MOCK_BUILDS());
  }
}
