import { Injectable, Logger } from '@nestjs/common';
import type { ApiHero, ApiItem, ApiMap } from './deadlock.types.js';

/**
 * URL base da Deadlock API em UM lugar só.
 * O host de assets já mudou uma vez (assets.deadlock-api.com saiu do ar);
 * se mudar de novo, é só trocar aqui ou no .env (DEADLOCK_API_URL).
 */
export const DEFAULT_DEADLOCK_API_URL = 'https://api.deadlock-api.com';

type Lang = 'brazilian' | 'english';

@Injectable()
export class DeadlockApiClient {
  private readonly logger = new Logger(DeadlockApiClient.name);
  private readonly baseUrl = (process.env['DEADLOCK_API_URL'] ?? DEFAULT_DEADLOCK_API_URL).replace(/\/+$/, '');

  getHeroes(lang: Lang): Promise<ApiHero[]> {
    return this.get<ApiHero[]>('/v1/assets/heroes', lang);
  }

  getItems(lang: Lang): Promise<ApiItem[]> {
    return this.get<ApiItem[]>('/v1/assets/items', lang);
  }

  /** NPCs (monstros, chefes, estruturas). Pode vir como lista ou objeto. */
  getNpcUnits(lang: Lang): Promise<unknown> {
    return this.get<unknown>('/v1/assets/npc-units', lang, 3, false);
  }

  getMap(): Promise<ApiMap> {
    return this.get<ApiMap>('/v1/assets/map', 'english', 3, false);
  }

  getIcons(): Promise<unknown> {
    return this.get<unknown>('/v1/assets/icons', 'english', 3, false);
  }

  private async get<T>(path: string, lang: Lang, attempts = 3, expectList = true): Promise<T> {
    const url = `${this.baseUrl}${path}?language=${lang}`;

    for (let attempt = 1; ; attempt++) {
      try {
        const res = await fetch(url, {
          headers: {
            Accept: 'application/json',
            // Identifica o DDhub para os mantenedores da API comunitária
            'User-Agent': 'DDhub/0.1 (portal da comunidade BR de Deadlock)',
          },
          signal: AbortSignal.timeout(60_000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} em ${path}`);

        const data = (await res.json()) as unknown;
        if (expectList && !Array.isArray(data)) throw new Error(`Resposta inesperada em ${path}: não é uma lista`);
        if (!expectList && (data === null || typeof data !== 'object')) {
          throw new Error(`Resposta inesperada em ${path}`);
        }
        return data as T;
      } catch (err) {
        if (attempt >= attempts) throw err;
        const waitMs = 2_000 * attempt;
        this.logger.warn(`Falha ao buscar ${path} (${lang}), tentativa ${attempt}/${attempts}: ${String(err)}. Nova tentativa em ${waitMs} ms`);
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }
  }
}