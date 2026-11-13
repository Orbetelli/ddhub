import {
  BadRequestException,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';

import { SupabaseService } from '../supabase/supabase.service.js';
import { GameSyncService } from './game-sync.service.js';
import { MemoryCache, TTL } from '../cache/memory-cache.service.js';

const SLUG = /^[a-z0-9-]{1,60}$/;

@Controller()
export class GameDataController {
  constructor(
    private readonly sync: GameSyncService,
    private readonly supabase: SupabaseService,
    private readonly cache: MemoryCache,
  ) {}

  /** Lista de heróis jogáveis (para /herois no Angular). */
  @Get('heroes')
  listHeroes() {
    return this.cache.get('heroes', TTL.game, () => this.loadHeroes());
  }

  private async loadHeroes() {
    const { data, error } = await this.supabase.db.from('hero_cards').select('*').order('name');
    if (error) throw new InternalServerErrorException('Não foi possível carregar os heróis.');
    return data;
  }

  /** Página do herói: dados do jogo + habilidades + guia publicado. */
  @Get('heroes/:slug')
  getHero(@Param('slug') slug: string) {
    if (!SLUG.test(slug)) throw new BadRequestException('Slug inválido.');
    return this.cache.get(`hero:${slug}`, TTL.content, () => this.loadHero(slug));
  }

  private async loadHero(slug: string) {

    const { data, error } = await this.supabase.db
      .from('heroes')
      .select(
        `id, slug, name, name_en, hero_type, complexity, color_hex, gun_tag, tags, tags_en,
         role, playstyle, lore, images, starting_stats, popular_items,
         hero_abilities ( slot, items ( id, slug, name, name_en, image_url, description, properties, upgrades ) ),
         hero_guides ( summary_md, lane_md, early_md, mid_md, late_md, combos_md, strengths, weaknesses, published_at )`,
      )
      .eq('slug', slug)
      .eq('is_selectable', true)
      .maybeSingle();

    if (error) throw new InternalServerErrorException('Não foi possível carregar o herói.');
    if (!data) throw new NotFoundException('Herói não encontrado.');

    // Guia só aparece se estiver publicado
    const guide = Array.isArray(data.hero_guides) ? data.hero_guides[0] : data.hero_guides;
    const published = guide?.published_at && new Date(guide.published_at) <= new Date() ? guide : null;

    return {
      ...data,
      hero_abilities: [...(data.hero_abilities ?? [])].sort((a: { slot: number }, b: { slot: number }) => a.slot - b.slot),
      hero_guides: undefined,
      popular_items: undefined,
      popular: await this.enrichPopularItems(data.popular_items),
      guide: published,
    };
  }

  /** Troca os IDs de itens populares por nome/imagem/custo, ordenados por pick rate. */
  private async enrichPopularItems(popular: unknown) {
    type Entry = { item_id: number; pick_pct: number; winrate_pct: number };
    const phases = ['early_game', 'mid_game', 'late_game'] as const;
    const src = (popular ?? {}) as Partial<Record<(typeof phases)[number], Entry[]>>;

    const ids = [...new Set(phases.flatMap((p) => (src[p] ?? []).map((e) => e.item_id)))];
    if (ids.length === 0) return { early: [], mid: [], late: [] };

    const { data: items, error } = await this.supabase.db
      .from('items')
      .select('id, slug, name, name_en, slot, tier, cost, image_url, shop_image_url')
      .in('id', ids);
    if (error) return { early: [], mid: [], late: [] };

    const byId = new Map((items ?? []).map((i: { id: number }) => [Number(i.id), i]));
    const build = (entries: Entry[] = []) =>
      entries
        .filter((e) => byId.has(e.item_id))
        .sort((a, b) => b.pick_pct - a.pick_pct)
        .slice(0, 12)
        .map((e) => ({
          ...(byId.get(e.item_id) as Record<string, unknown>),
          pick_pct: Math.round(e.pick_pct * 10) / 10,
          winrate_pct: Math.round(e.winrate_pct * 10) / 10,
        }));

    return { early: build(src.early_game), mid: build(src.mid_game), late: build(src.late_game) };
  }

  /**
   * Dispara a sincronização na hora.
   * Protegido por token até o login de admin existir (etapa 3):
   *   curl -X POST http://localhost:3000/admin/sync -H "x-admin-token: SEU_TOKEN"
   */
  @Post('admin/sync')
  @HttpCode(200)
  async runSync(@Headers('x-admin-token') token?: string) {
    this.assertAdmin(token);
    if (this.sync.isRunning()) throw new ConflictException('Já existe uma sincronização em andamento.');
    return this.sync.sync(); // limpa o cache sozinho ao terminar
  }

  private assertAdmin(token?: string): void {
    const expected = process.env['ADMIN_SYNC_TOKEN'];
    // Sem token configurado (ou curto demais) a rota fica desligada
    if (!expected || expected.length < 32 || !token) throw new ForbiddenException();
    const a = Buffer.from(token);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ForbiddenException();
  }
}