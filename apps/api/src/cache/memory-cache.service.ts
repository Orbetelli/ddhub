import { Injectable } from '@nestjs/common';

interface Entry {
  expires: number;
  value: Promise<unknown>;
}

/** Tempos de cache usados pelas rotas. */
export const TTL = {
  /** Dados do jogo (heróis, mapa): o sync roda uma vez por dia. */
  game: 10 * 60 * 1000,
  /** Conteúdo do DDhub (guias, criadores): o content:sync limpa o cache na hora. */
  content: 10 * 60 * 1000,
} as const;

/**
 * Cache em memória simples, compartilhado pela API.
 *
 * - Guarda a Promise: várias requisições ao mesmo tempo esperam uma única consulta ao banco.
 * - Erros não ficam em cache (a próxima requisição tenta de novo).
 * - POST /admin/cache/clear limpa tudo (o "npm run content:sync" chama sozinho).
 */
@Injectable()
export class MemoryCache {
  private readonly store = new Map<string, Entry>();

  get<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const hit = this.store.get(key);
    if (hit && hit.expires > now) return hit.value as Promise<T>;

    const value = load();
    this.store.set(key, { expires: now + ttlMs, value });
    value.catch(() => {
      // Só remove se ainda for esta mesma tentativa
      if (this.store.get(key)?.value === value) this.store.delete(key);
    });
    return value;
  }

  clear(): number {
    const size = this.store.size;
    this.store.clear();
    return size;
  }
}