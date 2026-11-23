// Formato da resposta de GET /stats/heroes (API NestJS)

export interface HeroStat {
  slug: string;
  name: string;
  image: string | null;
  /** Arte grande do herói (card) */
  art?: string | null;
  /** Em porcentagem, com 1 casa (ex.: 53.9) */
  win_rate: number;
  matches: number;
}

export interface HeroStatsResponse {
  since: string | null;
  badge: string;
  heroes: HeroStat[];
}

export const EMPTY_HERO_STATS: HeroStatsResponse = { since: null, badge: 'Phantom+', heroes: [] };
