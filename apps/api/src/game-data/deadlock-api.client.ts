import { Injectable, Logger } from '@nestjs/common';
import type { ApiHero, ApiItem } from './deadlock.types.js';

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

  private async get<T>(path: string, lang: Lang, attempts = 3): Promise<T> {
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
        if (!Array.isArray(data)) throw new Error(`Resposta inesperada em ${path}: não é uma lista`);
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
