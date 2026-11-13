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

const SLUG = /^[a-z0-9-]{1,60}$/;

@Controller()
export class GameDataController {
  constructor(
    private readonly sync: GameSyncService,
    private readonly supabase: SupabaseService,
  ) {}

  /** Lista de heróis jogáveis (para /herois no Angular). */
  @Get('heroes')
  async listHeroes() {
    const { data, error } = await this.supabase.db.from('hero_cards').select('*').order('name');
    if (error) throw new InternalServerErrorException('Não foi possível carregar os heróis.');
    return data;
  }

  /** Página do herói: dados do jogo + habilidades + guia publicado. */
  @Get('heroes/:slug')
  async getHero(@Param('slug') slug: string) {
    if (!SLUG.test(slug)) throw new BadRequestException('Slug inválido.');

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
      hero_abilities: [...(data.hero_abilities ?? [])].sort((a, b) => a.slot - b.slot),
      hero_guides: undefined,
      guide: published,
    };
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
    return this.sync.sync();
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
