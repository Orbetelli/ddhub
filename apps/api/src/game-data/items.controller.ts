import {
  BadRequestException,
  Controller,
  Get,
  InternalServerErrorException,
  NotFoundException,
  Param,
} from '@nestjs/common';

import { SupabaseService } from '../supabase/supabase.service.js';
import { MemoryCache, TTL } from '../cache/memory-cache.service.js';

const SLUG = /^[a-z0-9-]{1,80}$/;

type Slot = 'weapon' | 'vitality' | 'spirit';

/** Item como aparece na loja (/itens). */
export interface ShopItem {
  id: number;
  slug: string;
  name: string;
  name_en: string | null;
  slot: Slot | null;
  tier: number | null;
  cost: number | null;
  image_url: string | null;
  is_active_item: boolean;
  /** Slugs dos itens que compõem este (ex.: um item tier 3 feito de um tier 1). */
  components: string[];
  /** Slugs dos itens que usam este como componente. */
  builds_into: string[];
}

export interface HeroBuyer {
  slug: string;
  name: string;
  name_en: string | null;
  image: string | null;
  pick_pct: number;
  winrate_pct: number;
}

interface Catalog {
  items: ShopItem[];
  bySlug: Map<string, ShopItem>;
  /** id do item → heróis que mais compram (maior pick rate em qualquer fase). */
  buyers: Map<number, HeroBuyer[]>;
}

type Row = Record<string, any>;

/**
 * Itens da loja de Deadlock (só os compráveis e ativos no jogo).
 * Os dados vêm do banco, alimentado pelo sync diário da Deadlock API.
 */
@Controller('items')
export class ItemsController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly cache: MemoryCache,
  ) {}

  @Get()
  async list(): Promise<ShopItem[]> {
    return (await this.getCatalog()).items;
  }

  @Get(':slug')
  get(@Param('slug') slug: string) {
    if (!SLUG.test(slug)) throw new BadRequestException('Slug inválido.');
    return this.cache.get(`item:${slug}`, TTL.game, () => this.loadItem(slug));
  }

  private async loadItem(slug: string) {
    const catalog = await this.getCatalog();
    const base = catalog.bySlug.get(slug);
    if (!base) throw new NotFoundException('Item não encontrado.');

    const { data, error } = await this.supabase.db
      .from('items')
      .select('shop_image_url, activation, description, description_en, properties, upgrades')
      .eq('id', base.id)
      .maybeSingle();
    if (error || !data) throw new InternalServerErrorException('Não foi possível carregar o item.');

    const brief = (s: string) => {
      const i = catalog.bySlug.get(s);
      return i && { slug: i.slug, name: i.name, name_en: i.name_en, slot: i.slot, tier: i.tier, cost: i.cost, image_url: i.image_url };
    };

    return {
      ...base,
      ...data,
      components: base.components.map(brief).filter(Boolean),
      builds_into: base.builds_into.map(brief).filter(Boolean),
      top_heroes: catalog.buyers.get(base.id) ?? [],
    };
  }

  // ───────────────────────── catálogo em cache ─────────────────────────
  private getCatalog(): Promise<Catalog> {
    return this.cache.get('items-catalog', TTL.game, () => this.loadCatalog());
  }

  private async loadCatalog(): Promise<Catalog> {
    const db = this.supabase.db;
    const [itemsRes, heroesRes, cardsRes] = await Promise.all([
      db
        .from('items')
        .select('id, slug, class_name, name, name_en, slot, tier, cost, image_url, shop_image_url, is_active_item, components:raw->component_items')
        .eq('type', 'upgrade')
        .eq('shopable', true)
        .eq('is_active', true),
      db.from('heroes').select('slug, popular_items').eq('is_selectable', true),
      db.from('hero_cards').select('slug, name, name_en, small_image'),
    ]);
    if (itemsRes.error || heroesRes.error || cardsRes.error) {
      throw new InternalServerErrorException('Não foi possível carregar os itens.');
    }

    const rows = (itemsRes.data ?? []) as Row[];
    const slugByClass = new Map(rows.map((r) => [r['class_name'] as string, r['slug'] as string]));

    const items: ShopItem[] = rows.map((r) => ({
      id: Number(r['id']),
      slug: r['slug'],
      name: r['name'],
      name_en: r['name_en'],
      slot: r['slot'],
      tier: r['tier'],
      cost: r['cost'],
      image_url: r['shop_image_url'] ?? r['image_url'],
      is_active_item: r['is_active_item'] === true,
      // component_items vem como lista de class_name ("upgrade_clip_size")
      components: (Array.isArray(r['components']) ? r['components'] : [])
        .map((c: unknown) => (typeof c === 'string' ? slugByClass.get(c) : undefined))
        .filter((s: string | undefined): s is string => !!s),
      builds_into: [],
    }));

    const bySlug = new Map(items.map((i) => [i.slug, i]));
    for (const item of items) {
      for (const c of item.components) bySlug.get(c)?.builds_into.push(item.slug);
    }

    items.sort(
      (a, b) =>
        (a.tier ?? 9) - (b.tier ?? 9) || (a.cost ?? 0) - (b.cost ?? 0) || a.name.localeCompare(b.name, 'pt-BR'),
    );

    return { items, bySlug, buyers: this.buildBuyers(heroesRes.data as Row[], cardsRes.data as Row[]) };
  }

  /** Para cada item, os heróis com maior taxa de compra (melhor fase de cada herói). */
  private buildBuyers(heroes: Row[] = [], cards: Row[] = []): Map<number, HeroBuyer[]> {
    const cardBySlug = new Map(cards.map((c) => [c['slug'], c]));
    const buyers = new Map<number, HeroBuyer[]>();

    for (const h of heroes) {
      const card = cardBySlug.get(h['slug']);
      if (!card) continue;
      const best = new Map<number, { pick_pct: number; winrate_pct: number }>();
      const popular = (h['popular_items'] ?? {}) as Record<string, { item_id: number; pick_pct: number; winrate_pct: number }[]>;
      for (const phase of ['early_game', 'mid_game', 'late_game']) {
        for (const e of popular[phase] ?? []) {
          const prev = best.get(e.item_id);
          if (!prev || e.pick_pct > prev.pick_pct) best.set(e.item_id, { pick_pct: e.pick_pct, winrate_pct: e.winrate_pct });
        }
      }
      for (const [itemId, stats] of best) {
        const list = buyers.get(itemId) ?? [];
        list.push({
          slug: card['slug'],
          name: card['name'],
          name_en: card['name_en'],
          image: card['small_image'],
          pick_pct: Math.round(stats.pick_pct * 10) / 10,
          winrate_pct: Math.round(stats.winrate_pct * 10) / 10,
        });
        buyers.set(itemId, list);
      }
    }
    for (const [id, list] of buyers) buyers.set(id, list.sort((a, b) => b.pick_pct - a.pick_pct).slice(0, 8));
    return buyers;
  }
}