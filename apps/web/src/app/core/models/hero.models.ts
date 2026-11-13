// Formato das respostas de GET /heroes e GET /heroes/:slug (API NestJS)

export type HeroType = 'assassin' | 'brawler' | 'marksman' | 'mystic';

export interface HeroCard {
  id: number;
  slug: string;
  name: string; // nome oficial em PT-BR
  name_en: string | null;
  hero_type: HeroType | null;
  complexity: number | null;
  color_hex: string | null;
  role: string | null;
  tags: string[];
  card_image: string | null;
  small_image: string | null;
}

export interface AbilityProperty {
  label?: string;
  value?: string | number;
  postfix?: string;
  icon?: string;
}

export interface AbilityItem {
  id: number;
  slug: string;
  name: string;
  name_en: string | null;
  image_url: string | null;
  description: Record<string, unknown>;
  properties: Record<string, AbilityProperty>;
  upgrades: { property_upgrades?: { name: string; bonus: string | number }[] }[];
}

export interface PopularItem {
  id: number;
  slug: string;
  name: string;
  name_en: string | null;
  slot: 'weapon' | 'vitality' | 'spirit' | null;
  tier: number | null;
  cost: number | null;
  image_url: string | null;
  shop_image_url: string | null;
  pick_pct: number;
  winrate_pct: number;
}

export interface HeroGuide {
  summary_md: string | null;
  lane_md: string | null;
  early_md: string | null;
  mid_md: string | null;
  late_md: string | null;
  combos_md: string | null;
  strengths: string[];
  weaknesses: string[];
}

export interface HeroDetail {
  id: number;
  slug: string;
  name: string;
  name_en: string | null;
  hero_type: HeroType | null;
  complexity: number | null;
  color_hex: string | null;
  gun_tag: string | null;
  tags: string[];
  tags_en: string[];
  role: string | null;
  playstyle: string | null;
  lore: string | null;
  images: Record<string, string>;
  starting_stats: Record<string, number>;
  hero_abilities: { slot: number; items: AbilityItem | null }[];
  popular: { early: PopularItem[]; mid: PopularItem[]; late: PopularItem[] };
  guide: HeroGuide | null;
}

export const HERO_TYPE_LABEL: Record<HeroType, string> = {
  assassin: 'Assassino',
  brawler: 'Lutador',
  marksman: 'Atirador',
  mystic: 'Místico',
};

export const COMPLEXITY_LABEL: Record<number, string> = {
  1: 'Fácil',
  2: 'Médio',
  3: 'Difícil',
};