// Formato (parcial) das respostas de https://api.deadlock-api.com/v1/assets/*
// Só o que o DDhub usa. O payload completo é guardado na coluna `raw`.

export interface ApiHeroDescription {
  lore?: string;
  role?: string;
  playstyle?: string;
}

export interface ApiPopularItem {
  item_id: number;
  class_name: string;
  pick_pct: number;
  winrate_pct: number;
}

export interface ApiHero {
  id: number;
  class_name: string;
  name: string;
  description?: ApiHeroDescription;
  player_selectable?: boolean;
  disabled?: boolean;
  in_development?: boolean;
  tags?: string[];
  gun_tag?: string;
  hero_type?: string;
  search_name?: string;
  complexity?: number;
  images?: Record<string, string>;
  items?: Record<string, string>; // signature1..4 → class_name da habilidade
  starting_stats?: Record<string, { value: number; display_stat_name?: string }>;
  colors?: { style_hex?: string };
  shop_stat_display?: { weapon_stats_display?: { weapon_image_webp?: string; weapon_image?: string } };
  popular_items?: {
    timestamp?: number;
    early_game?: ApiPopularItem[];
    mid_game?: ApiPopularItem[];
    late_game?: ApiPopularItem[];
  };
  [key: string]: unknown;
}

export type ApiItemType = 'ability' | 'weapon' | 'upgrade';

export interface ApiItem {
  id: number;
  type: ApiItemType;
  class_name: string;
  name: string;
  image?: string;
  image_webp?: string;
  shop_image?: string;
  shop_image_webp?: string;
  heroes?: number[];
  properties?: Record<string, unknown>;
  description?: Record<string, unknown>;
  upgrades?: unknown[];
  item_slot_type?: string;
  item_tier?: number;
  cost?: number;
  activation?: string;
  is_active_item?: boolean;
  shopable?: boolean;
  disabled?: boolean;
  [key: string]: unknown;
}
