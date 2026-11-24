import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';

import { SupabaseService } from '../supabase/supabase.service.js';
import { MemoryCache, TTL } from '../cache/memory-cache.service.js';
import { SessionService } from '../auth/session.service.js';
import type { SessionUser } from '../auth/session.service.js';
import { assertSameOrigin, cleanLine, cleanText, optionalUser, requireUser } from '../auth/request-user.js';
import type { HttpReq } from '../auth/request-user.js';

type Row = Record<string, any>;
export type Phase = 'early' | 'mid' | 'late' | 'situational';
const PHASES: Phase[] = ['early', 'mid', 'late', 'situational'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9-]{1,80}$/;

/** Limites (contra spam e builds gigantes) */
const MAX_ITEMS = 40;
const MAX_BUILDS_PER_USER = 50;
const MAX_NEW_PER_HOUR = 10;
const PAGE_MAX = 24;

interface ItemInfo {
  id: number;
  slug: string;
  name: string;
  name_en: string | null;
  slot: string | null;
  tier: number | null;
  cost: number | null;
  image_url: string | null;
}
interface HeroInfo {
  id: number;
  slug: string;
  name: string;
  name_en: string | null;
  image: string | null;
}

interface BuildBody {
  hero?: unknown;
  title?: unknown;
  description?: unknown;
  published?: unknown;
  items?: unknown;
}

interface HttpRes {
  setHeader(name: string, value: string): unknown;
}

const BUILD_SELECT =
  'id, title, description, patch, score, is_published, created_at, updated_at, hero_id, author_id, users!builds_author_id_fkey(username, display_name, avatar_url), build_items(position, phase, item_id, note)';

/**
 * Builds da comunidade.
 *   GET    /builds?heroi=&ordem=top|novas&pagina=   → builds publicadas
 *   GET    /builds/mine                            → as suas (inclui rascunhos)
 *   GET    /builds/:id                             → detalhe (rascunho: só o autor)
 *   POST   /builds                                 → cria
 *   PUT    /builds/:id                             → edita (autor)
 *   DELETE /builds/:id                             → apaga (autor ou moderação)
 *   POST   /builds/:id/vote  { value: 1 | -1 | 0 } → vota (não vale na própria)
 *   GET    /users/:username/builds                 → builds publicadas de alguém
 */
@Controller()
export class BuildsController {
  private readonly recent = new Map<string, number[]>();

  constructor(
    private readonly supabase: SupabaseService,
    private readonly cache: MemoryCache,
    private readonly sessions: SessionService,
  ) {}

  // ───────────────────────── leitura ─────────────────────────
  @Get('builds')
  async list(@Query('heroi') heroSlug?: string, @Query('ordem') sort?: string, @Query('pagina') page?: string) {
    const [heroes, items, latest] = await Promise.all([this.heroes(), this.items(), this.latestPatch()]);
    const p = Math.min(Math.max(Number.parseInt(page ?? '1', 10) || 1, 1), 40);
    let q = this.supabase.db.from('builds').select(BUILD_SELECT, { count: 'exact' }).eq('is_published', true);
    if (heroSlug) {
      const h = SLUG.test(heroSlug) ? [...heroes.values()].find((x) => x.slug === heroSlug) : undefined;
      if (!h) return { page: p, total: 0, builds: [] };
      q = q.eq('hero_id', h.id);
    }
    q = sort === 'novas' ? q.order('updated_at', { ascending: false }) : q.order('score', { ascending: false }).order('updated_at', { ascending: false });
    const { data, error, count } = await q.range((p - 1) * PAGE_MAX, p * PAGE_MAX - 1);
    if (error) throw new InternalServerErrorException('Builds indisponíveis no momento.');
    return { page: p, total: count ?? 0, builds: ((data ?? []) as Row[]).map((b) => this.card(b, heroes, items, latest)) };
  }

  @Get('builds/mine')
  async mine(@Req() req: HttpReq, @Res({ passthrough: true }) res: HttpRes) {
    res.setHeader('Cache-Control', 'no-store');
    const me = await requireUser(this.sessions, req);
    const [heroes, items, latest] = await Promise.all([this.heroes(), this.items(), this.latestPatch()]);
    const { data, error } = await this.supabase.db.from('builds').select(BUILD_SELECT).eq('author_id', me.id).order('updated_at', { ascending: false });
    if (error) throw new InternalServerErrorException('Builds indisponíveis no momento.');
    return { builds: ((data ?? []) as Row[]).map((b) => this.card(b, heroes, items, latest)) };
  }

  @Get('users/:username/builds')
  async byUser(@Param('username') username: string) {
    if (!/^[A-Za-z0-9_]{3,24}$/.test(username ?? '')) throw new NotFoundException('Perfil não encontrado.');
    const { data: u } = await this.supabase.db.from('users').select('id, deleted_at, is_banned').eq('username', username).maybeSingle();
    if (!u || u['deleted_at'] || u['is_banned']) throw new NotFoundException('Perfil não encontrado.');
    const [heroes, items, latest] = await Promise.all([this.heroes(), this.items(), this.latestPatch()]);
    const { data, error } = await this.supabase.db
      .from('builds')
      .select(BUILD_SELECT)
      .eq('author_id', u['id'])
      .eq('is_published', true)
      .order('score', { ascending: false })
      .limit(50);
    if (error) throw new InternalServerErrorException('Builds indisponíveis no momento.');
    return { builds: ((data ?? []) as Row[]).map((b) => this.card(b, heroes, items, latest)) };
  }

  @Get('builds/:id')
  async detail(@Param('id') id: string, @Req() req: HttpReq, @Res({ passthrough: true }) res: HttpRes) {
    if (!UUID.test(id ?? '')) throw new NotFoundException('Build não encontrada.');
    res.setHeader('Cache-Control', 'no-store');
    const [me, heroes, items, latest] = await Promise.all([optionalUser(this.sessions, req), this.heroes(), this.items(), this.latestPatch()]);
    const { data: b, error } = await this.supabase.db.from('builds').select(BUILD_SELECT).eq('id', id).maybeSingle();
    if (error) throw new InternalServerErrorException('Build indisponível no momento.');
    const mineOrStaff = !!me && (b?.['author_id'] === me.id || isStaff(me));
    if (!b || (!b['is_published'] && !mineOrStaff)) throw new NotFoundException('Build não encontrada.');

    let myVote = 0;
    if (me && b['author_id'] !== me.id) {
      const { data: v } = await this.supabase.db.from('build_votes').select('value').eq('build_id', id).eq('user_id', me.id).maybeSingle();
      myVote = Number(v?.['value'] ?? 0);
    }

    const rows = ((b['build_items'] ?? []) as Row[]).sort((x, y) => x['position'] - y['position']);
    const phases = PHASES.map((phase) => {
      const list = rows
        .filter((r) => r['phase'] === phase)
        .map((r) => ({ ...briefItem(items.get(Number(r['item_id']))), note: r['note'] ?? null }))
        .filter((i) => i.slug);
      return { phase, items: list, cost: list.reduce((s, i) => s + (i.cost ?? 0), 0) };
    });

    return {
      ...this.card(b, heroes, items, latest),
      description: b['description'] ?? null,
      phases,
      my_vote: myVote,
      can_edit: !!me && b['author_id'] === me.id,
      can_delete: mineOrStaff,
    };
  }

  // ───────────────────────── escrita ─────────────────────────
  @Post('builds')
  async create(@Req() req: HttpReq, @Body() body: BuildBody) {
    assertSameOrigin(req);
    const me = await requireUser(this.sessions, req);
    this.rateLimit(me.id);
    const { count } = await this.supabase.db.from('builds').select('id', { count: 'exact', head: true }).eq('author_id', me.id);
    if ((count ?? 0) >= MAX_BUILDS_PER_USER) throw new BadRequestException(`Limite de ${MAX_BUILDS_PER_USER} builds por conta. Apague alguma antiga.`);

    const v = await this.validate(body);
    const { data, error } = await this.supabase.db
      .from('builds')
      .insert({ author_id: me.id, hero_id: v.heroId, title: v.title, description: v.description, is_published: v.published, patch: await this.latestPatch() })
      .select('id')
      .single();
    if (error || !data) throw new InternalServerErrorException('Não deu para salvar a build agora.');
    await this.saveItems(data['id'], v.items, true);
    return { id: data['id'] };
  }

  @Put('builds/:id')
  async update(@Param('id') id: string, @Req() req: HttpReq, @Body() body: BuildBody) {
    assertSameOrigin(req);
    const me = await requireUser(this.sessions, req);
    await this.ownBuild(id, me, false);
    const v = await this.validate(body);
    const { error } = await this.supabase.db
      .from('builds')
      .update({ hero_id: v.heroId, title: v.title, description: v.description, is_published: v.published, patch: await this.latestPatch() })
      .eq('id', id);
    if (error) throw new InternalServerErrorException('Não deu para salvar a build agora.');
    await this.saveItems(id, v.items, false);
    return { id };
  }

  @Delete('builds/:id')
  @HttpCode(204)
  async remove(@Param('id') id: string, @Req() req: HttpReq): Promise<void> {
    assertSameOrigin(req);
    const me = await requireUser(this.sessions, req);
    await this.ownBuild(id, me, true);
    const { error } = await this.supabase.db.from('builds').delete().eq('id', id);
    if (error) throw new InternalServerErrorException('Não deu para apagar agora.');
  }

  @Post('builds/:id/vote')
  @HttpCode(200)
  async vote(@Param('id') id: string, @Req() req: HttpReq, @Body() body: { value?: unknown }) {
    assertSameOrigin(req);
    const me = await requireUser(this.sessions, req);
    if (!UUID.test(id ?? '')) throw new NotFoundException('Build não encontrada.');
    const value = Number(body?.value);
    if (![1, -1, 0].includes(value)) throw new BadRequestException('Voto inválido.');
    const { data: b } = await this.supabase.db.from('builds').select('author_id, is_published').eq('id', id).maybeSingle();
    if (!b || !b['is_published']) throw new NotFoundException('Build não encontrada.');
    if (b['author_id'] === me.id) throw new BadRequestException('Não dá para votar na própria build.');

    const db = this.supabase.db;
    const { error } =
      value === 0
        ? await db.from('build_votes').delete().eq('build_id', id).eq('user_id', me.id)
        : await db.from('build_votes').upsert({ build_id: id, user_id: me.id, value }, { onConflict: 'build_id,user_id' });
    if (error) throw new InternalServerErrorException('Não deu para votar agora.');
    const { data: after } = await db.from('builds').select('score').eq('id', id).single();
    return { score: Number(after?.['score'] ?? 0), my_vote: value };
  }

  // ───────────────────────── apoio ─────────────────────────
  private async validate(body: BuildBody) {
    const heroes = await this.heroes();
    const heroSlug = typeof body?.hero === 'string' ? body.hero : '';
    const hero = [...heroes.values()].find((h) => h.slug === heroSlug);
    if (!hero) throw new BadRequestException('Escolha um herói.');

    const title = cleanLine(body?.title);
    if (title.length < 3 || title.length > 80) throw new BadRequestException('O título precisa ter de 3 a 80 caracteres.');
    const description = cleanText(body?.description);
    if (description.length > 3000) throw new BadRequestException('A descrição pode ter até 3000 caracteres.');

    if (!Array.isArray(body?.items)) throw new BadRequestException('Lista de itens inválida.');
    if (body.items.length > MAX_ITEMS) throw new BadRequestException(`No máximo ${MAX_ITEMS} itens por build.`);
    const bySlug = new Map([...(await this.items()).values()].map((i) => [i.slug, i]));
    const seen = new Set<string>();
    const items: { item_id: number; phase: Phase; note: string | null }[] = [];
    for (const raw of body.items as Row[]) {
      const slug = typeof raw?.['item'] === 'string' ? raw['item'] : '';
      const phase = raw?.['phase'] as Phase;
      const info = bySlug.get(slug);
      if (!info) throw new BadRequestException('Algum item não existe mais na loja. Remova e tente de novo.');
      if (!PHASES.includes(phase)) throw new BadRequestException('Fase inválida.');
      if (seen.has(slug)) continue; // cada item uma vez por build
      seen.add(slug);
      const note = cleanLine(raw?.['note']).slice(0, 120);
      items.push({ item_id: info.id, phase, note: note || null });
    }
    const published = body?.published === true;
    if (published && items.length < 3) throw new BadRequestException('Para publicar, coloque pelo menos 3 itens.');
    return { heroId: hero.id, title, description: description || null, published, items };
  }

  private async saveItems(buildId: string, items: { item_id: number; phase: Phase; note: string | null }[], isNew: boolean) {
    const db = this.supabase.db;
    if (!isNew) {
      const { error } = await db.from('build_items').delete().eq('build_id', buildId);
      if (error) throw new InternalServerErrorException('Não deu para salvar os itens.');
    }
    if (!items.length) return;
    const { error } = await db.from('build_items').insert(items.map((it, i) => ({ build_id: buildId, position: i + 1, ...it })));
    if (error) {
      if (isNew) await db.from('builds').delete().eq('id', buildId);
      throw new InternalServerErrorException('Não deu para salvar os itens.');
    }
  }

  private async ownBuild(id: string, me: SessionUser, staffOk: boolean): Promise<void> {
    if (!UUID.test(id ?? '')) throw new NotFoundException('Build não encontrada.');
    const { data } = await this.supabase.db.from('builds').select('author_id').eq('id', id).maybeSingle();
    if (!data) throw new NotFoundException('Build não encontrada.');
    if (data['author_id'] !== me.id && !(staffOk && isStaff(me))) throw new ForbiddenException('Essa build não é sua.');
  }

  private rateLimit(userId: string): void {
    const now = Date.now();
    const list = (this.recent.get(userId) ?? []).filter((t) => now - t < 60 * 60 * 1000);
    if (list.length >= MAX_NEW_PER_HOUR) throw new HttpException('Muitas builds novas em pouco tempo. Espere um pouco.', HttpStatus.TOO_MANY_REQUESTS);
    list.push(now);
    this.recent.set(userId, list);
    if (this.recent.size > 5000) this.recent.clear();
  }

  private card(b: Row, heroes: Map<number, HeroInfo>, items: Map<number, ItemInfo>, latest: string | null) {
    const h = heroes.get(Number(b['hero_id']));
    const u = b['users'] as Row | null;
    const rows = ((b['build_items'] ?? []) as Row[]).sort((x, y) => x['position'] - y['position']);
    return {
      id: b['id'],
      title: b['title'],
      hero: h ? { slug: h.slug, name: h.name, name_en: h.name_en, image: h.image } : null,
      author: u ? { username: u['username'], display_name: u['display_name'], avatar_url: u['avatar_url'] } : null,
      score: Number(b['score'] ?? 0),
      published: !!b['is_published'],
      patch: b['patch'] ?? null,
      outdated: !!(latest && b['patch'] && b['patch'] < latest),
      item_count: rows.length,
      preview: rows
        .filter((r) => r['phase'] !== 'situational')
        .slice(0, 8)
        .map((r) => items.get(Number(r['item_id'])))
        .filter((i): i is ItemInfo => !!i)
        .map((i) => ({ slug: i.slug, name: i.name, image_url: i.image_url, slot: i.slot })),
      created_at: b['created_at'],
      updated_at: b['updated_at'],
    };
  }

  private heroes(): Promise<Map<number, HeroInfo>> {
    return this.cache.get('builds:heroes', TTL.game, async () => {
      const { data, error } = await this.supabase.db.from('hero_cards').select('id, slug, name, name_en, small_image');
      if (error) throw new InternalServerErrorException('Builds indisponíveis no momento.');
      return new Map(((data ?? []) as Row[]).map((h) => [Number(h['id']), { id: Number(h['id']), slug: h['slug'], name: h['name'], name_en: h['name_en'] ?? null, image: h['small_image'] ?? null }]));
    });
  }

  /** Itens da loja (compráveis e ativos), por id. */
  private items(): Promise<Map<number, ItemInfo>> {
    return this.cache.get('builds:items', TTL.game, async () => {
      const { data, error } = await this.supabase.db
        .from('items')
        .select('id, slug, name, name_en, slot, tier, cost, image_url')
        .eq('type', 'upgrade')
        .eq('shopable', true)
        .eq('is_active', true);
      if (error) throw new InternalServerErrorException('Builds indisponíveis no momento.');
      return new Map(((data ?? []) as Row[]).map((i) => [Number(i['id']), { ...(i as ItemInfo), id: Number(i['id']) }]));
    });
  }

  /** Data (AAAA-MM-DD) do último patch: builds mais antigas ganham o aviso "antes do patch". */
  private latestPatch(): Promise<string | null> {
    return this.cache.get('builds:patch', TTL.content, async () => {
      const { data } = await this.supabase.db
        .from('patch_notes')
        .select('published_at')
        .eq('is_patch', true)
        .order('published_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data?.['published_at'] ? String(data['published_at']).slice(0, 10) : null;
    });
  }
}

function isStaff(u: SessionUser): boolean {
  return u.role === 'admin' || u.role === 'moderator';
}

function briefItem(i: ItemInfo | undefined) {
  return i
    ? { slug: i.slug, name: i.name, name_en: i.name_en, slot: i.slot, tier: i.tier, cost: i.cost, image_url: i.image_url }
    : { slug: '', name: '', name_en: null, slot: null, tier: null, cost: null, image_url: null };
}
