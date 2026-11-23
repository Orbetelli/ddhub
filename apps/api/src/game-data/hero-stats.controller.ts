import { Controller, Get, Logger } from '@nestjs/common';

import { SupabaseService } from '../supabase/supabase.service.js';
import { MemoryCache } from '../cache/memory-cache.service.js';
import { DEFAULT_DEADLOCK_API_URL } from './deadlock-api.client.js';

/** Win rate muda devagar: perguntamos à API comunitária no máximo a cada 3 horas. */
const STATS_TTL = 3 * 60 * 60 * 1000;
/** Se a API falhar, esperamos 10 min antes de tentar de novo (bom vizinho). */
const FAIL_COOLDOWN = 10 * 60 * 1000;
/** Menos partidas que isso = amostra pequena demais para entrar no ranking. */
const MIN_MATCHES = 300;
/** Badge mínima da partida (Phantom 1 = 91). Dá para trocar no .env. */
const MIN_BADGE = Number(process.env['HERO_STATS_MIN_BADGE'] ?? 91);

export interface HeroStat {
  slug: string;
  name: string;
  image: string | null;
  /** Arte grande do herói (card), para destaque */
  art: string | null;
  win_rate: number;
  matches: number;
}

export interface HeroStatsResponse {
  /** Desde quando as partidas foram contadas (ISO). */
  since: string | null;
  badge: string;
  heroes: HeroStat[];
}

const EMPTY: HeroStatsResponse = { since: null, badge: 'Phantom+', heroes: [] };

type Row = Record<string, any>;

/**
 * GET /stats/heroes — heróis com maior win rate desde o último patch, em partidas Phantom+.
 * Fonte: Deadlock API (api.deadlock-api.com/v1/analytics/hero-stats).
 * Se a API estiver fora, devolve lista vazia e a home simplesmente esconde o bloco.
 */
@Controller('stats')
export class HeroStatsController {
  private readonly logger = new Logger(HeroStatsController.name);
  private readonly baseUrl = (process.env['DEADLOCK_API_URL'] ?? DEFAULT_DEADLOCK_API_URL).replace(/\/+$/, '');
  private failedAt = 0;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly cache: MemoryCache,
  ) {}

  @Get('heroes')
  async heroes(): Promise<HeroStatsResponse> {
    if (Date.now() - this.failedAt < FAIL_COOLDOWN) return EMPTY;
    try {
      return await this.cache.get('stats:heroes', STATS_TTL, () => this.load());
    } catch (err) {
      this.failedAt = Date.now();
      this.logger.warn(`Estatísticas de heróis indisponíveis: ${String(err)}`);
      return EMPTY;
    }
  }

  private async load(): Promise<HeroStatsResponse> {
    const since = await this.sinceDate();
    const params = new URLSearchParams({
      min_unix_timestamp: String(Math.floor(since.getTime() / 1000)),
      min_average_badge: String(MIN_BADGE),
    });
    const res = await fetch(`${this.baseUrl}/v1/analytics/hero-stats?${params}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'DDhub/0.1 (portal da comunidade BR de Deadlock)' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = (await res.json()) as unknown;
    if (!Array.isArray(raw)) throw new Error('resposta não é uma lista');

    // Soma por herói (a API pode devolver mais de uma linha por herói, ex.: por bucket)
    const totals = new Map<number, { wins: number; matches: number }>();
    for (const r of raw as Row[]) {
      const id = Number(r['hero_id']);
      const wins = Number(r['wins'] ?? 0);
      const matches = Number(r['matches'] ?? (Number(r['wins'] ?? 0) + Number(r['losses'] ?? 0)));
      if (!Number.isFinite(id) || !Number.isFinite(wins) || !Number.isFinite(matches) || matches <= 0) continue;
      const t = totals.get(id) ?? { wins: 0, matches: 0 };
      t.wins += wins;
      t.matches += matches;
      totals.set(id, t);
    }

    const { data, error } = await this.supabase.db.from('hero_cards').select('id, slug, name, small_image, card_image');
    if (error) throw new Error('não foi possível ler os heróis');
    const byId = new Map(((data ?? []) as Row[]).map((h) => [Number(h['id']), h]));

    const heroes: HeroStat[] = [];
    for (const [id, t] of totals) {
      const h = byId.get(id);
      if (!h || t.matches < MIN_MATCHES) continue;
      heroes.push({
        slug: h['slug'],
        name: h['name'],
        image: h['small_image'] ?? null,
        art: h['card_image'] ?? null,
        win_rate: Math.round((t.wins / t.matches) * 1000) / 10,
        matches: t.matches,
      });
    }
    heroes.sort((a, b) => b.win_rate - a.win_rate);
    if (!heroes.length) throw new Error('sem dados suficientes');
    return { since: since.toISOString(), badge: 'Phantom+', heroes: heroes.slice(0, 10) };
  }

  /** Data do último patch; se ele for muito recente (menos de 3 dias), usa os últimos 7 dias. */
  private async sinceDate(): Promise<Date> {
    const week = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const { data } = await this.supabase.db
      .from('patch_notes')
      .select('published_at')
      .eq('is_patch', true)
      .order('published_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const patch = data?.published_at ? new Date(data.published_at as string) : null;
    if (!patch || Date.now() - patch.getTime() < 3 * 24 * 60 * 60 * 1000) return week;
    return patch;
  }
}
