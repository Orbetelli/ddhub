// Funções puras que transformam o JSON da Deadlock API em linhas do banco.
// Sem dependência de Nest/Supabase → fáceis de testar.

import type { ApiHero, ApiItem } from './deadlock.types.js';

export interface HeroRow {
  id: number;
  slug: string;
  class_name: string;
  name: string;
  name_en: string | null;
  search_name: string | null;
  hero_type: string | null;
  complexity: number | null;
  color_hex: string | null;
  gun_tag: string | null;
  tags: string[];
  tags_en: string[];
  role: string | null;
  role_en: string | null;
  playstyle: string | null;
  playstyle_en: string | null;
  lore: string | null;
  lore_en: string | null;
  images: Record<string, string>;
  image_small_url: string | null;
  starting_stats: Record<string, number>;
  popular_items: unknown;
  is_selectable: boolean;
  is_active: boolean;
  raw: unknown;
  synced_at: string;
}

export interface ItemRow {
  id: number;
  slug: string;
  class_name: string;
  type: ApiItem['type'];
  name: string;
  name_en: string | null;
  slot: 'weapon' | 'vitality' | 'spirit' | null;
  tier: number | null;
  cost: number | null;
  image_url: string | null;
  shop_image_url: string | null;
  activation: string | null;
  is_active_item: boolean;
  shopable: boolean;
  hero_ids: number[];
  description: Record<string, unknown>;
  description_en: Record<string, unknown>;
  properties: Record<string, unknown>;
  upgrades: unknown[];
  is_active: boolean;
  raw: unknown;
  synced_at: string;
}

export interface HeroAbilityRow {
  hero_id: number;
  slot: number;
  item_id: number;
}

/** "Mo & Krill" → "mo-and-krill", "Lady Geist" → "lady-geist" */
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const SLOTS = new Set(['weapon', 'vitality', 'spirit']);
const HEX = /^#[0-9A-Fa-f]{6}$/;

/** Herói aparece no site se for jogável e não estiver desativado (bate com os 44 da wiki). */
export function isSelectable(h: ApiHero): boolean {
  return h.player_selectable === true && h.disabled !== true;
}

export function mapHeroes(pt: ApiHero[], en: ApiHero[], now = new Date()): HeroRow[] {
  const enById = new Map(en.map((h) => [h.id, h]));
  const usedSlugs = new Set<string>();

  return pt.map((h) => {
    const e = enById.get(h.id);
    let slug = slugify(e?.name ?? h.name) || `heroi-${h.id}`;
    if (usedSlugs.has(slug)) slug = `${slug}-${h.id}`;
    usedSlugs.add(slug);

    const stats: Record<string, number> = {};
    for (const [key, stat] of Object.entries(h.starting_stats ?? {})) {
      if (typeof stat?.value === 'number') stats[key] = stat.value;
    }

    const weapon = h.shop_stat_display?.weapon_stats_display;
    const images: Record<string, string> = { ...(h.images ?? {}) };
    const weaponImage = weapon?.weapon_image_webp ?? weapon?.weapon_image;
    if (weaponImage) images['weapon_image'] = weaponImage;

    const color = h.colors?.style_hex;

    return {
      id: h.id,
      slug,
      class_name: h.class_name,
      name: h.name,
      name_en: e?.name ?? null,
      search_name: h.search_name ?? null,
      hero_type: h.hero_type ?? null,
      complexity: typeof h.complexity === 'number' ? h.complexity : null,
      color_hex: color && HEX.test(color) ? color : null,
      gun_tag: h.gun_tag ?? null,
      tags: h.tags ?? [],
      tags_en: e?.tags ?? [],
      role: h.description?.role ?? null,
      role_en: e?.description?.role ?? null,
      playstyle: h.description?.playstyle ?? null,
      playstyle_en: e?.description?.playstyle ?? null,
      lore: h.description?.lore ?? null,
      lore_en: e?.description?.lore ?? null,
      images,
      image_small_url: h.images?.['icon_image_small_webp'] ?? h.images?.['icon_image_small'] ?? null,
      starting_stats: stats,
      popular_items: h.popular_items ?? null,
      is_selectable: isSelectable(h),
      is_active: h.disabled !== true,
      raw: h,
      synced_at: now.toISOString(),
    };
  });
}

export function mapItems(pt: ApiItem[], en: ApiItem[], now = new Date()): ItemRow[] {
  const enById = new Map(en.map((i) => [i.id, i]));
  const usedSlugs = new Set<string>();

  return pt
    .filter((i) => i.type === 'ability' || i.type === 'weapon' || i.type === 'upgrade')
    .map((i) => {
      const e = enById.get(i.id);
      // class_name é estável entre patches e idiomas: "upgrade_clip_size" → "clip-size"
      let slug = slugify(i.class_name.replace(/^(upgrade|ability|citadel_ability|citadel_weapon|weapon)_/, ''));
      if (!slug || usedSlugs.has(slug)) slug = `${slug || 'item'}-${i.id}`;
      usedSlugs.add(slug);

      const slot = i.item_slot_type && SLOTS.has(i.item_slot_type) ? (i.item_slot_type as ItemRow['slot']) : null;
      const tier = typeof i.item_tier === 'number' && i.item_tier >= 1 && i.item_tier <= 5 ? i.item_tier : null;
      const cost = typeof i.cost === 'number' && i.cost >= 0 ? i.cost : null;

      return {
        id: i.id,
        slug,
        class_name: i.class_name,
        type: i.type,
        name: i.name,
        name_en: e?.name ?? null,
        slot,
        tier,
        cost,
        image_url: i.image_webp ?? i.image ?? null,
        shop_image_url: i.shop_image_webp ?? i.shop_image ?? null,
        activation: i.activation ?? null,
        is_active_item: i.is_active_item === true,
        shopable: i.shopable === true,
        hero_ids: Array.isArray(i.heroes) ? i.heroes.filter((x) => Number.isInteger(x)) : [],
        description: i.description ?? {},
        description_en: e?.description ?? {},
        properties: i.properties ?? {},
        upgrades: Array.isArray(i.upgrades) ? i.upgrades : [],
        is_active: i.disabled !== true,
        raw: i,
        synced_at: now.toISOString(),
      };
    });
}

/** signature1..4 do herói → linhas de hero_abilities (ignora habilidades que não existem nos itens). */
export function mapHeroAbilities(heroes: ApiHero[], itemIdByClass: Map<string, number>): HeroAbilityRow[] {
  const rows: HeroAbilityRow[] = [];
  for (const h of heroes) {
    for (let slot = 1; slot <= 4; slot++) {
      const className = h.items?.[`signature${slot}`];
      const itemId = className ? itemIdByClass.get(className) : undefined;
      if (itemId !== undefined) rows.push({ hero_id: h.id, slot, item_id: itemId });
    }
  }
  return rows;
}
