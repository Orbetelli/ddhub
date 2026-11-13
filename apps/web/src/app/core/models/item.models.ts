// Formato das respostas de GET /items e GET /items/:slug (API NestJS)

export type ItemSlot = 'weapon' | 'vitality' | 'spirit';

export interface ShopItem {
  id: number;
  slug: string;
  name: string;
  name_en: string | null;
  slot: ItemSlot | null;
  tier: number | null;
  cost: number | null;
  image_url: string | null;
  is_active_item: boolean;
  components: string[];
  builds_into: string[];
}

export interface ItemBrief {
  slug: string;
  name: string;
  name_en: string | null;
  slot: ItemSlot | null;
  tier: number | null;
  cost: number | null;
  image_url: string | null;
}

export interface ItemProperty {
  label?: string;
  value?: string | number;
  prefix?: string;
  postfix?: string;
  conditional?: string;
  disable_value?: string | number;
}

export interface HeroBuyer {
  slug: string;
  name: string;
  name_en: string | null;
  image: string | null;
  pick_pct: number;
  winrate_pct: number;
}

export interface ItemDetail extends Omit<ShopItem, 'components' | 'builds_into'> {
  shop_image_url: string | null;
  activation: string | null;
  description: Record<string, unknown>;
  description_en: Record<string, unknown>;
  properties: Record<string, ItemProperty>;
  components: ItemBrief[];
  builds_into: ItemBrief[];
  top_heroes: HeroBuyer[];
}

export const SLOT_LABEL: Record<ItemSlot, string> = {
  weapon: 'Arma',
  vitality: 'Vitalidade',
  spirit: 'Espiritual',
};