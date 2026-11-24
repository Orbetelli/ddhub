#!/usr/bin/env bash
# Builds da comunidade: criar, editar, publicar, votar (/builds) + builds no perfil
# Rode na raiz do repositório:  cd ~/ddhub && bash aplicar-builds.sh
set -e
[ -d apps/api/src/auth ] || { echo "Rode na raiz do repositório (cd ~/ddhub)."; exit 1; }
mkdir -p supabase/migrations apps/api/src/builds apps/web/src/app/shared/build-card apps/web/src/app/features/builds

cat > 'supabase/migrations/20261124120000_builds.sql' <<'DDHUB_EOF'
-- =====================================================================
-- DDhub — Builds da comunidade (as tabelas já existem desde o schema inicial)
--
-- Tudo é gravado só pela API (chave secreta), que confere quem está logado.
-- Quem votou em qual build não é público: a API devolve só a soma (score).
-- =====================================================================

revoke insert, update, delete on public.builds, public.build_items, public.build_votes from anon, authenticated;

drop policy if exists "leitura pública" on public.build_votes;
revoke select on public.build_votes from anon, authenticated;

-- Listagens: mais votadas e mais novas
create index if not exists builds_published_score_idx on public.builds (score desc, updated_at desc) where is_published;
create index if not exists builds_published_new_idx on public.builds (updated_at desc) where is_published;
create index if not exists build_votes_user_idx on public.build_votes (user_id);

notify pgrst, 'reload schema';
DDHUB_EOF
echo "ok  supabase/migrations/20261124120000_builds.sql"

cat > 'apps/api/src/auth/request-user.ts' <<'DDHUB_EOF'
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';

import { SESSION_COOKIE, SessionService, readCookie, webUrl } from './session.service.js';
import type { SessionUser } from './session.service.js';

/** O mínimo do Request que usamos (sem depender dos tipos do Express). */
export interface HttpReq {
  headers: Record<string, string | string[] | undefined>;
}

export function header(req: HttpReq, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

/** Quem está logado (ou null). */
export function optionalUser(sessions: SessionService, req: HttpReq): Promise<SessionUser | null> {
  return sessions.user(readCookie(header(req, 'cookie'), SESSION_COOKIE));
}

/** Quem está logado; se ninguém, 401. */
export async function requireUser(sessions: SessionService, req: HttpReq): Promise<SessionUser> {
  const user = await optionalUser(sessions, req);
  if (!user) throw new UnauthorizedException('Entre com a sua conta.');
  return user;
}

/** Alterações só podem vir do próprio site (contra CSRF; o cookie SameSite=Lax já ajuda). */
export function assertSameOrigin(req: HttpReq): void {
  const origin = header(req, 'origin');
  if (origin && origin.replace(/\/+$/, '') !== webUrl()) throw new ForbiddenException('Origem não permitida.');
  if (!origin && header(req, 'sec-fetch-site') === 'cross-site') throw new ForbiddenException('Origem não permitida.');
}

/** Uma linha de texto: sem caracteres de controle/invisíveis, espaços colapsados. */
export function cleanLine(v: unknown): string {
  return typeof v === 'string' ? v.replace(INVISIBLE, '').replace(/\s+/g, ' ').trim() : '';
}

/** Texto com parágrafos: mantém quebras de linha (no máximo 2 seguidas). */
export function cleanText(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v
    .replace(/\r\n?/g, '\n')
    .replace(INVISIBLE_KEEP_NL, '')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g;
const INVISIBLE_KEEP_NL = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g;
DDHUB_EOF
echo "ok  apps/api/src/auth/request-user.ts"

cat > 'apps/api/src/builds/builds.controller.ts' <<'DDHUB_EOF'
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
DDHUB_EOF
echo "ok  apps/api/src/builds/builds.controller.ts"

cat > 'apps/api/src/builds/builds.module.ts' <<'DDHUB_EOF'
import { Module } from '@nestjs/common';

import { BuildsController } from './builds.controller.js';

/** SessionService vem do AuthModule (global). */
@Module({ controllers: [BuildsController] })
export class BuildsModule {}
DDHUB_EOF
echo "ok  apps/api/src/builds/builds.module.ts"

cat > 'apps/web/src/app/core/services/builds.service.ts' <<'DDHUB_EOF'
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, firstValueFrom } from 'rxjs';

import { API_BASE_URL } from '../api.config';

/**
 * Leitura pública vai direto na API; o que precisa de login (criar, editar, votar,
 * "minhas builds" e o detalhe com o seu voto) passa por /api, no próprio site, por causa do cookie.
 */
const SITE_API = '/api';

export type BuildPhase = 'early' | 'mid' | 'late' | 'situational';

export const PHASE_LABEL: Record<BuildPhase, string> = {
  early: 'Início',
  mid: 'Meio',
  late: 'Fim',
  situational: 'Situacional',
};
export const PHASES: BuildPhase[] = ['early', 'mid', 'late', 'situational'];

export interface BuildCard {
  id: string;
  title: string;
  hero: { slug: string; name: string; name_en: string | null; image: string | null } | null;
  author: { username: string; display_name: string; avatar_url: string | null } | null;
  score: number;
  published: boolean;
  patch: string | null;
  outdated: boolean;
  item_count: number;
  preview: { slug: string; name: string; image_url: string | null; slot: string | null }[];
  created_at: string;
  updated_at: string;
}

export interface BuildItem {
  slug: string;
  name: string;
  name_en: string | null;
  slot: 'weapon' | 'vitality' | 'spirit' | null;
  tier: number | null;
  cost: number | null;
  image_url: string | null;
  note: string | null;
}

export interface BuildDetail extends BuildCard {
  description: string | null;
  phases: { phase: BuildPhase; items: BuildItem[]; cost: number }[];
  my_vote: number;
  can_edit: boolean;
  can_delete: boolean;
}

export interface BuildInput {
  hero: string;
  title: string;
  description: string;
  published: boolean;
  items: { item: string; phase: BuildPhase; note?: string }[];
}

@Injectable({ providedIn: 'root' })
export class BuildsService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_BASE_URL);

  list(hero: string | null, sort: 'top' | 'novas', page = 1): Observable<{ page: number; total: number; builds: BuildCard[] }> {
    const params: Record<string, string> = { ordem: sort, pagina: String(page) };
    if (hero) params['heroi'] = hero;
    return this.http.get<{ page: number; total: number; builds: BuildCard[] }>(`${this.api}/builds`, { params });
  }

  byUser(username: string): Observable<{ builds: BuildCard[] }> {
    return this.http.get<{ builds: BuildCard[] }>(`${this.api}/users/${encodeURIComponent(username)}/builds`);
  }

  mine(): Promise<{ builds: BuildCard[] }> {
    return firstValueFrom(this.http.get<{ builds: BuildCard[] }>(`${SITE_API}/builds/mine`));
  }

  get(id: string): Observable<BuildDetail> {
    return this.http.get<BuildDetail>(`${SITE_API}/builds/${encodeURIComponent(id)}`);
  }

  create(input: BuildInput): Promise<{ id: string }> {
    return firstValueFrom(this.http.post<{ id: string }>(`${SITE_API}/builds`, input));
  }

  update(id: string, input: BuildInput): Promise<{ id: string }> {
    return firstValueFrom(this.http.put<{ id: string }>(`${SITE_API}/builds/${encodeURIComponent(id)}`, input));
  }

  remove(id: string): Promise<unknown> {
    return firstValueFrom(this.http.delete(`${SITE_API}/builds/${encodeURIComponent(id)}`));
  }

  vote(id: string, value: 1 | -1 | 0): Promise<{ score: number; my_vote: number }> {
    return firstValueFrom(this.http.post<{ score: number; my_vote: number }>(`${SITE_API}/builds/${encodeURIComponent(id)}/vote`, { value }));
  }
}
DDHUB_EOF
echo "ok  apps/web/src/app/core/services/builds.service.ts"

cat > 'apps/web/src/app/shared/build-card/build-card.ts' <<'DDHUB_EOF'
import { Component, input } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';

import { BuildCard as Build } from '../../core/services/builds.service';

/** Cartão de build para listas (builds, perfil, herói). */
@Component({
  selector: 'app-build-card',
  imports: [DatePipe, RouterLink],
  template: `
    @let b = build();
    <a class="card" [routerLink]="['/builds', b.id]">
      <div class="top">
        @if (b.hero?.image) {
          <img class="hero" [src]="b.hero!.image" [alt]="b.hero!.name" width="48" height="48" loading="lazy" />
        }
        <div class="info">
          <strong class="title">{{ b.title }}</strong>
          <span class="meta">
            {{ b.hero?.name }}
            @if (showAuthor() && b.author) {
              · por {{ b.author.display_name }}
            }
            · {{ b.updated_at | date: 'dd/MM/yy' }}
          </span>
        </div>
        <span class="score" [class.neg]="b.score < 0" title="Votos">{{ b.score > 0 ? '+' + b.score : b.score }}</span>
      </div>
      <div class="items">
        @for (i of b.preview; track i.slug) {
          <img [src]="i.image_url" [alt]="i.name" [title]="i.name" [class]="'slot-' + i.slot" width="34" height="34" loading="lazy" />
        }
        @if (b.item_count > b.preview.length) {
          <span class="more">+{{ b.item_count - b.preview.length }}</span>
        }
      </div>
      <div class="tags">
        @if (!b.published) {
          <span class="tag tag--draft">Rascunho</span>
        }
        @if (b.outdated) {
          <span class="tag" title="Feita antes do último patch: pode estar desatualizada">Antes do último patch</span>
        }
      </div>
    </a>
  `,
  styles: `
    .card { display: flex; flex-direction: column; gap: 10px; height: 100%; padding: 14px; background: var(--surface); border: 1px solid var(--border); color: var(--text); text-decoration: none; transition: border-color .15s; }
    .card:hover { border-color: var(--accent); color: var(--text); }
    .top { display: flex; gap: 10px; align-items: center; }
    .hero { width: 48px; height: 48px; border-radius: 4px; object-fit: cover; flex: none; }
    .info { display: flex; flex-direction: column; min-width: 0; flex: 1; }
    .title { color: var(--text-strong); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .meta { font-size: 13px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .score { font-family: var(--font-display); font-size: 20px; color: var(--win); }
    .score.neg { color: var(--live); }
    .items { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
    .items img { width: 34px; height: 34px; border-radius: 4px; background: var(--bg-deep); border-bottom: 2px solid transparent; }
    .items .slot-weapon { border-color: #e8913a; }
    .items .slot-vitality { border-color: #6fbf4a; }
    .items .slot-spirit { border-color: #a46cd8; }
    .more { font-size: 13px; color: var(--muted); padding-left: 4px; }
    .tags { display: flex; gap: 6px; flex-wrap: wrap; margin-top: auto; }
    .tag { font-size: 11px; padding: 2px 6px; background: var(--surface-sub); color: var(--muted); }
    .tag--draft { background: var(--accent-soft); color: var(--text-strong); }
    .tags:empty { display: none; }
  `,
})
export class BuildCard {
  readonly build = input.required<Build>();
  readonly showAuthor = input(true);
}
DDHUB_EOF
echo "ok  apps/web/src/app/shared/build-card/build-card.ts"

cat > 'apps/web/src/app/features/builds/builds.scss' <<'DDHUB_EOF'
// Estilos compartilhados das páginas de builds (lista, minhas, detalhe, editor)
.page {
  padding-top: 28px;
  padding-bottom: 48px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.head {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 16px;
  flex-wrap: wrap;
}

.kicker {
  margin: 0;
  font-family: var(--font-cond);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: 13px;
  color: var(--accent);
}

h1 {
  margin: 2px 0 4px;
  font-family: var(--font-display);
  color: var(--text-strong);
  overflow-wrap: anywhere;
}

h2 {
  margin: 0 0 10px;
  font-family: var(--font-cond);
  font-size: 18px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-strong);
}

.sub,
.muted {
  margin: 0;
  color: var(--muted);
}

.small {
  font-size: 13px;
}

.actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 40px;
  padding: 0 16px;
  border: 1px solid var(--accent);
  border-radius: 2px;
  background: var(--accent);
  color: var(--bg);
  font-family: var(--font-cond);
  font-size: 15px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  text-decoration: none;
  white-space: nowrap;
  cursor: pointer;

  &:hover {
    color: var(--bg);
  }

  &:disabled {
    opacity: 0.45;
    cursor: default;
  }

  &--ghost {
    background: none;
    color: var(--text-strong);
    border-color: var(--border);

    &:hover:not(:disabled) {
      border-color: var(--accent);
      color: var(--text-strong);
    }
  }

  &--danger {
    background: none;
    border-color: var(--live);
    color: var(--live);

    &:hover:not(:disabled) {
      background: var(--live);
      color: #fff;
    }
  }
}

.filters {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 12px 20px;

  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13px;
    color: var(--muted);
  }
}

select,
.input {
  height: 40px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 2px;
  background: var(--surface);
  color: var(--text-strong);
  font: inherit;
}

textarea.input {
  height: auto;
  padding: 10px;
  resize: vertical;
}

.chips {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;

  button {
    height: 40px;
    padding: 0 14px;
    border: 1px solid var(--border);
    border-radius: 2px;
    background: var(--surface);
    color: var(--muted);
    font: inherit;
    font-weight: 600;
    cursor: pointer;

    &.active {
      border-color: var(--accent);
      color: var(--text-strong);
      background: var(--accent-soft);
    }
  }
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
  padding: 24px;
  background: var(--surface);
  border: 1px dashed var(--border);

  p {
    margin: 0;
  }
}

.pager {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 16px;
  color: var(--muted);

  button {
    border: 0;
    background: none;
    color: var(--accent);
    font: inherit;
    cursor: pointer;

    &:disabled {
      color: var(--faint);
      cursor: default;
    }
  }
}

.msg {
  font-size: 14px;
  color: var(--live);

  &--ok {
    color: var(--win);
  }
}
DDHUB_EOF
echo "ok  apps/web/src/app/features/builds/builds.scss"

cat > 'apps/web/src/app/features/builds/build-list.ts' <<'DDHUB_EOF'
import { Component, computed, inject, input } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, combineLatest, map, of, startWith, switchMap } from 'rxjs';

import { BuildCard as Build, BuildsService } from '../../core/services/builds.service';
import { HeroesService } from '../../core/services/heroes.service';
import { NamePreferenceService } from '../../core/services/name-preference.service';
import { AuthService } from '../../core/services/auth.service';
import { BuildCard } from '../../shared/build-card/build-card';

type State = { status: 'loading' } | { status: 'error' } | { status: 'ok'; total: number; page: number; builds: Build[] };

const PAGE = 24;

/** /builds?heroi=haze&ordem=novas&pagina=2 */
@Component({
  selector: 'app-build-list',
  imports: [RouterLink, BuildCard],
  template: `
    <section class="container page">
      <header class="head">
        <div>
          <p class="kicker">Comunidade</p>
          <h1>Builds</h1>
          <p class="sub">Builds de itens montadas pela comunidade. Vote nas que funcionam.</p>
        </div>
        <div class="actions">
          @if (auth.user()) {
            <a class="btn btn--ghost" routerLink="/builds/minhas">Minhas builds</a>
            <a class="btn" routerLink="/builds/nova" [queryParams]="{ heroi: hero() }">Criar build</a>
          } @else if (auth.user() === null) {
            <a class="btn" [href]="auth.steamLoginUrl('/builds/nova')">Entrar para criar</a>
          }
        </div>
      </header>

      <div class="filters">
        <label>
          <span>Herói</span>
          <select [value]="hero() ?? ''" (change)="go({ heroi: $any($event.target).value || null, pagina: null })">
            <option value="">Todos os heróis</option>
            @for (h of heroes(); track h.slug) {
              <option [value]="h.slug">{{ names.primary(h.name, h.name_en) }}</option>
            }
          </select>
        </label>
        <div class="chips" role="group" aria-label="Ordem">
          <button type="button" [class.active]="sort() === 'top'" (click)="go({ ordem: null, pagina: null })">Mais votadas</button>
          <button type="button" [class.active]="sort() === 'novas'" (click)="go({ ordem: 'novas', pagina: null })">Mais novas</button>
        </div>
      </div>

      @switch (state().status) {
        @case ('loading') {
          <p class="muted">Carregando builds…</p>
        }
        @case ('error') {
          <p class="muted">Não deu para carregar as builds agora.</p>
        }
        @case ('ok') {
          @if (!list().length) {
            <div class="empty">
              <p>Nenhuma build {{ hero() ? 'para esse herói ' : '' }}ainda. Que tal ser a primeira pessoa?</p>
              <a class="btn" routerLink="/builds/nova" [queryParams]="{ heroi: hero() }">Criar build</a>
            </div>
          } @else {
            <div class="grid">
              @for (b of list(); track b.id) {
                <app-build-card [build]="b" />
              }
            </div>
            @if (pages() > 1) {
              <nav class="pager" aria-label="Páginas">
                <button type="button" [disabled]="page() <= 1" (click)="go({ pagina: page() - 1 })">« Anterior</button>
                <span>Página {{ page() }} de {{ pages() }}</span>
                <button type="button" [disabled]="page() >= pages()" (click)="go({ pagina: page() + 1 })">Próxima »</button>
              </nav>
            }
          }
        }
      }
    </section>
  `,
  styleUrl: './builds.scss',
})
export class BuildList {
  private readonly builds = inject(BuildsService);
  private readonly router = inject(Router);
  protected readonly auth = inject(AuthService);
  protected readonly names = inject(NamePreferenceService);

  readonly heroi = input<string | undefined>();
  readonly ordem = input<string | undefined>();
  readonly pagina = input<string | undefined>();

  protected readonly hero = computed(() => this.heroi() || null);
  protected readonly sort = computed<'top' | 'novas'>(() => (this.ordem() === 'novas' ? 'novas' : 'top'));
  protected readonly page = computed(() => Math.max(Number.parseInt(this.pagina() ?? '1', 10) || 1, 1));

  protected readonly heroes = toSignal(
    inject(HeroesService)
      .list()
      .pipe(
        map((hs) => [...hs].sort((a, b) => this.names.primary(a.name, a.name_en).localeCompare(this.names.primary(b.name, b.name_en), 'pt-BR'))),
        catchError(() => of([])),
      ),
    { initialValue: [] },
  );

  protected readonly state = toSignal(
    combineLatest([toObservable(this.hero), toObservable(this.sort), toObservable(this.page)]).pipe(
      switchMap(([h, s, p]) =>
        this.builds.list(h, s, p).pipe(
          map((r): State => ({ status: 'ok', total: r.total, page: r.page, builds: r.builds })),
          catchError(() => of<State>({ status: 'error' })),
          startWith<State>({ status: 'loading' }),
        ),
      ),
    ),
    { initialValue: { status: 'loading' } as State },
  );

  protected readonly list = computed(() => {
    const s = this.state();
    return s.status === 'ok' ? s.builds : [];
  });
  protected readonly pages = computed(() => {
    const s = this.state();
    return s.status === 'ok' ? Math.ceil(s.total / PAGE) : 0;
  });

  protected go(params: Record<string, string | number | null>): void {
    void this.router.navigate([], { queryParams: params, queryParamsHandling: 'merge' });
  }
}
DDHUB_EOF
echo "ok  apps/web/src/app/features/builds/build-list.ts"

cat > 'apps/web/src/app/features/builds/build-detail.ts' <<'DDHUB_EOF'
import { Component, computed, inject, input, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, startWith, switchMap } from 'rxjs';

import { BuildDetail as Build, BuildsService, PHASE_LABEL } from '../../core/services/builds.service';
import { AuthService } from '../../core/services/auth.service';
import { apiError } from '../../core/services/account.service';

type State = { status: 'loading' } | { status: 'missing' } | { status: 'ok'; build: Build };

/** /builds/:id */
@Component({
  selector: 'app-build-detail',
  imports: [DatePipe, DecimalPipe, RouterLink],
  template: `
    <section class="container page">
      @switch (state().status) {
        @case ('loading') {
          <p class="muted">Carregando build…</p>
        }
        @case ('missing') {
          <h1>Build não encontrada</h1>
          <p class="muted">Ela pode ter sido apagada ou ainda ser um rascunho.</p>
          <a routerLink="/builds">Ver outras builds</a>
        }
        @case ('ok') {
          @let b = build()!;
          <a class="back" routerLink="/builds" [queryParams]="{ heroi: b.hero?.slug }">« Builds{{ b.hero ? ' de ' + b.hero.name : '' }}</a>
          <header class="head detail-head">
            <div class="who">
              @if (b.hero?.image) {
                <a [routerLink]="['/herois', b.hero!.slug]"><img class="hero" [src]="b.hero!.image" [alt]="b.hero!.name" width="72" height="72" /></a>
              }
              <div>
                <h1>{{ b.title }}</h1>
                <p class="muted">
                  {{ b.hero?.name }}
                  @if (b.author) {
                    · por <a [routerLink]="['/u', b.author.username]">{{ b.author.display_name }}</a>
                  }
                  · atualizada em {{ b.updated_at | date: 'dd/MM/yyyy' }}
                </p>
                <div class="tags">
                  @if (!b.published) {
                    <span class="tag tag--draft">Rascunho: só você vê</span>
                  }
                  @if (b.outdated) {
                    <span class="tag">Feita antes do último patch: confira se ainda vale</span>
                  }
                </div>
              </div>
            </div>
            <div class="vote" aria-label="Votos">
              <button type="button" [class.on]="myVote() === 1" [disabled]="!canVote() || voting()" (click)="vote(1)" title="Boa build">▲</button>
              <strong [class.neg]="score() < 0">{{ score() }}</strong>
              <button type="button" [class.on]="myVote() === -1" [disabled]="!canVote() || voting()" (click)="vote(-1)" title="Não curti">▼</button>
              @if (voteHint(); as hint) {
                <small>{{ hint }}</small>
              }
            </div>
          </header>

          <div class="phases">
            @for (p of b.phases; track p.phase) {
              @if (p.items.length) {
                <section class="phase">
                  <header>
                    <h2>{{ phaseLabel[p.phase] }}</h2>
                    <span class="cost">{{ p.cost | number: '1.0-0' }} almas</span>
                  </header>
                  <ol>
                    @for (i of p.items; track i.slug) {
                      <li>
                        <a [routerLink]="['/itens', i.slug]" [class]="'item slot-' + i.slot">
                          <img [src]="i.image_url" alt="" width="44" height="44" loading="lazy" />
                          <span class="item__text">
                            <strong>{{ i.name }}</strong>
                            <small>Tier {{ i.tier }} · {{ i.cost | number: '1.0-0' }}</small>
                            @if (i.note) {
                              <em>{{ i.note }}</em>
                            }
                          </span>
                        </a>
                      </li>
                    }
                  </ol>
                </section>
              }
            }
          </div>

          @if (b.description) {
            <section class="desc">
              <h2>Como jogar com essa build</h2>
              <p>{{ b.description }}</p>
            </section>
          }

          <div class="actions">
            <button type="button" class="btn btn--ghost" (click)="copyLink()">{{ copied() ? 'Link copiado!' : 'Copiar link' }}</button>
            @if (b.can_edit) {
              <a class="btn btn--ghost" [routerLink]="['/builds', b.id, 'editar']">Editar</a>
            }
            @if (b.can_delete) {
              <button type="button" class="btn btn--danger" (click)="remove()" [disabled]="deleting()">
                {{ confirmDelete() ? 'Clique de novo para apagar' : 'Apagar' }}
              </button>
            }
            @if (error(); as e) {
              <span class="msg" role="alert">{{ e }}</span>
            }
          </div>
          <p class="muted small">Itens e imagens do jogo via Deadlock API · Deadlock é marca da Valve.</p>
        }
      }
    </section>
  `,
  styleUrl: './builds.scss',
  styles: `
    .back { font-size: 14px; }
    .detail-head { align-items: flex-start; }
    .who { display: flex; gap: 16px; align-items: flex-start; min-width: 0; }
    .hero { width: 72px; height: 72px; border-radius: 4px; object-fit: cover; border: 2px solid var(--accent); }
    .who p { margin: 0; }
    .tags { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
    .tag { font-size: 12px; padding: 3px 8px; background: var(--surface-sub); color: var(--muted); }
    .tag--draft { background: var(--accent-soft); color: var(--text-strong); }
    .vote { display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 72px; }
    .vote button { width: 40px; height: 32px; border: 1px solid var(--border); background: var(--surface); color: var(--muted); cursor: pointer; font-size: 14px; }
    .vote button.on { border-color: var(--accent); color: var(--accent); }
    .vote button:disabled { cursor: default; opacity: .6; }
    .vote strong { font-family: var(--font-display); font-size: 24px; color: var(--win); }
    .vote strong.neg { color: var(--live); }
    .vote small { font-size: 11px; color: var(--muted); text-align: center; max-width: 120px; }
    .phases { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
    .phase { background: var(--surface); border: 1px solid var(--border); padding: 14px; }
    .phase header { display: flex; justify-content: space-between; align-items: baseline; }
    .cost { font-size: 13px; color: var(--muted); }
    .phase ol { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .item { display: flex; gap: 10px; align-items: flex-start; color: var(--text); text-decoration: none; }
    .item img { width: 44px; height: 44px; border-radius: 4px; background: var(--bg-deep); border-bottom: 3px solid transparent; flex: none; }
    .slot-weapon img { border-color: #e8913a; }
    .slot-vitality img { border-color: #6fbf4a; }
    .slot-spirit img { border-color: #a46cd8; }
    .item__text { display: flex; flex-direction: column; min-width: 0; }
    .item__text strong { color: var(--text-strong); }
    .item__text small { font-size: 12px; color: var(--muted); }
    .item__text em { font-size: 13px; color: var(--text); font-style: normal; margin-top: 2px; }
    .item:hover strong { color: var(--accent); }
    .desc { background: var(--surface); border: 1px solid var(--border); padding: 16px; }
    .desc p { margin: 0; white-space: pre-line; overflow-wrap: anywhere; }
  `,
})
export class BuildDetail {
  private readonly builds = inject(BuildsService);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  readonly id = input.required<string>();

  protected readonly phaseLabel = PHASE_LABEL;
  protected readonly voting = signal(false);
  protected readonly deleting = signal(false);
  protected readonly confirmDelete = signal(false);
  protected readonly copied = signal(false);
  protected readonly error = signal<string | null>(null);
  /** Placar e voto depois de votar (sem recarregar a build) */
  private readonly override = signal<{ score: number; my_vote: number } | null>(null);

  protected readonly state = toSignal(
    toObservable(this.id).pipe(
      switchMap((id) =>
        this.builds.get(id).pipe(
          map((build): State => ({ status: 'ok', build })),
          catchError(() => of<State>({ status: 'missing' })),
          startWith<State>({ status: 'loading' }),
        ),
      ),
    ),
    { initialValue: { status: 'loading' } as State },
  );

  protected readonly build = computed(() => {
    const s = this.state();
    return s.status === 'ok' ? s.build : null;
  });
  protected readonly score = computed(() => this.override()?.score ?? this.build()?.score ?? 0);
  protected readonly myVote = computed(() => this.override()?.my_vote ?? this.build()?.my_vote ?? 0);
  protected readonly canVote = computed(() => {
    const b = this.build();
    const me = this.auth.user();
    return !!b && !!me && b.published && !b.can_edit;
  });
  protected readonly voteHint = computed(() => {
    const b = this.build();
    if (!b || !b.published) return null;
    if (this.auth.user() === null) return 'Entre para votar';
    if (b.can_edit) return 'Sua build';
    return null;
  });

  protected async vote(v: 1 | -1): Promise<void> {
    const b = this.build();
    if (!b || this.voting()) return;
    this.voting.set(true);
    this.error.set(null);
    try {
      const next = this.myVote() === v ? 0 : v;
      this.override.set(await this.builds.vote(b.id, next));
    } catch (err) {
      this.error.set(apiError(err));
    } finally {
      this.voting.set(false);
    }
  }

  protected async remove(): Promise<void> {
    const b = this.build();
    if (!b || this.deleting()) return;
    if (!this.confirmDelete()) {
      this.confirmDelete.set(true);
      setTimeout(() => this.confirmDelete.set(false), 4000);
      return;
    }
    this.deleting.set(true);
    try {
      await this.builds.remove(b.id);
      await this.router.navigateByUrl('/builds/minhas');
    } catch (err) {
      this.error.set(apiError(err));
      this.deleting.set(false);
    }
  }

  protected async copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(location.href);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
      /* sem permissão */
    }
  }
}
DDHUB_EOF
echo "ok  apps/web/src/app/features/builds/build-detail.ts"

cat > 'apps/web/src/app/features/builds/my-builds.ts' <<'DDHUB_EOF'
import { Component, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { BuildCard as Build, BuildsService } from '../../core/services/builds.service';
import { AuthService } from '../../core/services/auth.service';
import { BuildCard } from '../../shared/build-card/build-card';

/** /builds/minhas — as suas builds, inclusive rascunhos. */
@Component({
  selector: 'app-my-builds',
  imports: [RouterLink, BuildCard],
  template: `
    <section class="container page">
      <header class="head">
        <div>
          <a routerLink="/builds" class="small">« Builds</a>
          <h1>Minhas builds</h1>
          <p class="sub">Rascunhos só você vê. Publicadas aparecem para todo mundo e recebem votos.</p>
        </div>
        @if (auth.user()) {
          <a class="btn" routerLink="/builds/nova">Criar build</a>
        }
      </header>
      @if (auth.user() === undefined || (auth.user() && !loaded())) {
        <p class="muted">Carregando…</p>
      } @else if (!auth.user()) {
        <div class="empty">
          <p>Entre com a Steam para ver e criar as suas builds.</p>
          <a class="btn" [href]="auth.steamLoginUrl('/builds/minhas')">Entrar com Steam</a>
        </div>
      } @else if (error()) {
        <p class="muted">Não deu para carregar agora.</p>
      } @else if (!builds().length) {
        <div class="empty">
          <p>Você ainda não montou nenhuma build.</p>
          <a class="btn" routerLink="/builds/nova">Criar a primeira</a>
        </div>
      } @else {
        <div class="grid">
          @for (b of builds(); track b.id) {
            <app-build-card [build]="b" [showAuthor]="false" />
          }
        </div>
      }
    </section>
  `,
  styleUrl: './builds.scss',
})
export class MyBuilds {
  protected readonly auth = inject(AuthService);
  private readonly service = inject(BuildsService);

  protected readonly builds = signal<Build[]>([]);
  protected readonly loaded = signal(false);
  protected readonly error = signal(false);

  constructor() {
    effect(() => {
      if (this.auth.user() && !this.loaded()) {
        this.service
          .mine()
          .then((r) => this.builds.set(r.builds))
          .catch(() => this.error.set(true))
          .finally(() => this.loaded.set(true));
      }
    });
  }
}
DDHUB_EOF
echo "ok  apps/web/src/app/features/builds/my-builds.ts"

cat > 'apps/web/src/app/features/builds/build-editor.ts' <<'DDHUB_EOF'
import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, firstValueFrom, map, of } from 'rxjs';

import { BuildPhase, BuildsService, PHASE_LABEL, PHASES } from '../../core/services/builds.service';
import { AuthService } from '../../core/services/auth.service';
import { HeroesService } from '../../core/services/heroes.service';
import { ItemsService } from '../../core/services/items.service';
import { NamePreferenceService } from '../../core/services/name-preference.service';
import { apiError } from '../../core/services/account.service';
import { ItemSlot, ShopItem } from '../../core/models/item.models';

interface Picked {
  slug: string;
  phase: BuildPhase;
  note: string;
}

const MAX_ITEMS = 40;
const SLOT_LABEL: Record<ItemSlot, string> = { weapon: 'Arma', vitality: 'Vitalidade', spirit: 'Espiritual' };

/** /builds/nova (?heroi=) e /builds/:id/editar */
@Component({
  selector: 'app-build-editor',
  imports: [DecimalPipe, RouterLink],
  templateUrl: './build-editor.html',
  styleUrls: ['./builds.scss', './build-editor.scss'],
})
export class BuildEditor {
  protected readonly auth = inject(AuthService);
  private readonly builds = inject(BuildsService);
  private readonly router = inject(Router);
  protected readonly names = inject(NamePreferenceService);

  /** /builds/:id/editar */
  readonly id = input<string | undefined>();
  /** /builds/nova?heroi=haze */
  readonly heroi = input<string | undefined>();

  protected readonly phases = PHASES;
  protected readonly phaseLabel = PHASE_LABEL;
  protected readonly slotLabel = SLOT_LABEL;
  protected readonly slots: ItemSlot[] = ['weapon', 'vitality', 'spirit'];
  protected readonly maxItems = MAX_ITEMS;

  protected readonly heroes = toSignal(
    inject(HeroesService)
      .list()
      .pipe(
        map((hs) => [...hs].sort((a, b) => this.names.primary(a.name, a.name_en).localeCompare(this.names.primary(b.name, b.name_en), 'pt-BR'))),
        catchError(() => of([])),
      ),
    { initialValue: [] },
  );
  private readonly shop = toSignal(inject(ItemsService).list().pipe(catchError(() => of([] as ShopItem[]))), { initialValue: [] as ShopItem[] });
  private readonly bySlug = computed(() => new Map(this.shop().map((i) => [i.slug, i])));

  // Formulário
  protected readonly hero = signal('');
  protected readonly title = signal('');
  protected readonly description = signal('');
  protected readonly items = signal<Picked[]>([]);
  protected readonly published = signal(false);
  protected readonly activePhase = signal<BuildPhase>('early');

  // Loja
  protected readonly query = signal('');
  protected readonly slot = signal<ItemSlot | null>(null);
  protected readonly tier = signal<number | null>(null);

  protected readonly loading = signal(false);
  protected readonly notFound = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  private loadedId: string | null = null;

  protected readonly isEdit = computed(() => !!this.id());
  protected readonly used = computed(() => new Set(this.items().map((i) => i.slug)));

  protected readonly filteredShop = computed(() => {
    const q = norm(this.query());
    const s = this.slot();
    const t = this.tier();
    return this.shop()
      .filter((i) => (!s || i.slot === s) && (!t || i.tier === t))
      .filter((i) => !q || norm(i.name).includes(q) || norm(i.name_en ?? '').includes(q))
      .sort((a, b) => (a.tier ?? 0) - (b.tier ?? 0) || (a.slot ?? '').localeCompare(b.slot ?? '') || a.name.localeCompare(b.name, 'pt-BR'));
  });

  protected readonly grouped = computed(() =>
    PHASES.map((phase) => {
      const list = this.items()
        .map((p, index) => ({ ...p, index, info: this.bySlug().get(p.slug) }))
        .filter((p) => p.phase === phase);
      return { phase, list, cost: list.reduce((s, p) => s + (p.info?.cost ?? 0), 0) };
    }),
  );

  protected readonly canSave = computed(() => !!this.hero() && this.title().trim().length >= 3 && !this.saving());

  constructor() {
    // Editar: carrega a build uma vez, quando souber o id
    effect(() => {
      const id = this.id();
      if (!id || id === this.loadedId) return;
      this.loadedId = id;
      void this.load(id);
    });
    // Nova: herói sugerido pela URL
    effect(() => {
      const h = this.heroi();
      if (!this.id() && h && !this.hero()) this.hero.set(h);
    });
  }

  private async load(id: string): Promise<void> {
    this.loading.set(true);
    try {
      const b = await firstValueFrom(this.builds.get(id));
      if (!b.can_edit) {
        this.notFound.set(true);
        return;
      }
      this.hero.set(b.hero?.slug ?? '');
      this.title.set(b.title);
      this.description.set(b.description ?? '');
      this.published.set(b.published);
      this.items.set(b.phases.flatMap((p) => p.items.map((i) => ({ slug: i.slug, phase: p.phase, note: i.note ?? '' }))));
    } catch {
      this.notFound.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  protected add(item: ShopItem): void {
    if (this.used().has(item.slug) || this.items().length >= MAX_ITEMS) return;
    this.items.update((list) => [...list, { slug: item.slug, phase: this.activePhase(), note: '' }]);
  }

  protected removeAt(index: number): void {
    this.items.update((list) => list.filter((_, i) => i !== index));
  }

  /** Sobe/desce dentro da mesma fase. */
  protected move(index: number, dir: -1 | 1): void {
    this.items.update((list) => {
      const phase = list[index].phase;
      let j = index + dir;
      while (j >= 0 && j < list.length && list[j].phase !== phase) j += dir;
      if (j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  }

  protected setPhase(index: number, phase: BuildPhase): void {
    this.items.update((list) => {
      const next = [...list];
      const [moved] = next.splice(index, 1);
      next.push({ ...moved, phase });
      return next;
    });
  }

  protected setNote(index: number, note: string): void {
    this.items.update((list) => list.map((p, i) => (i === index ? { ...p, note: note.slice(0, 120) } : p)));
  }

  protected async save(publish: boolean): Promise<void> {
    if (!this.canSave()) return;
    this.saving.set(true);
    this.error.set(null);
    const input = {
      hero: this.hero(),
      title: this.title(),
      description: this.description(),
      published: publish,
      items: this.items().map((p) => ({ item: p.slug, phase: p.phase, note: p.note.trim() || undefined })),
    };
    try {
      const id = this.id();
      const res = id ? await this.builds.update(id, input) : await this.builds.create(input);
      await this.router.navigate(['/builds', res.id]);
    } catch (err) {
      this.error.set(apiError(err, 'Não deu para salvar. Tente de novo.'));
    } finally {
      this.saving.set(false);
    }
  }
}

function norm(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}
DDHUB_EOF
echo "ok  apps/web/src/app/features/builds/build-editor.ts"

cat > 'apps/web/src/app/features/builds/build-editor.html' <<'DDHUB_EOF'
<section class="container page">
  <header class="head">
    <div>
      <a routerLink="/builds/minhas" class="small">« Minhas builds</a>
      <h1>{{ isEdit() ? 'Editar build' : 'Nova build' }}</h1>
      <p class="sub">Clique nos itens da loja para colocar na fase escolhida. Rascunhos só você vê.</p>
    </div>
  </header>

  @if (auth.user() === undefined || loading()) {
    <p class="muted">Carregando…</p>
  } @else if (!auth.user()) {
    <div class="empty">
      <p>Entre com a Steam para montar uma build.</p>
      <a class="btn" [href]="auth.steamLoginUrl('/builds/nova')">Entrar com Steam</a>
    </div>
  } @else if (notFound()) {
    <div class="empty">
      <p>Essa build não existe ou não é sua.</p>
      <a class="btn" routerLink="/builds">Ver builds</a>
    </div>
  } @else {
    <div class="basics">
      <label>
        <span>Herói</span>
        <select [value]="hero()" (change)="hero.set($any($event.target).value)">
          <option value="" disabled>Escolha o herói</option>
          @for (h of heroes(); track h.slug) {
            <option [value]="h.slug">{{ names.primary(h.name, h.name_en) }}</option>
          }
        </select>
      </label>
      <label class="grow">
        <span>Título</span>
        <input class="input" type="text" maxlength="80" placeholder="Ex.: Haze de crítico para a lane" [value]="title()" (input)="title.set($any($event.target).value)" />
      </label>
    </div>

    <div class="editor">
      <!-- Build -->
      <div class="build">
        @for (g of grouped(); track g.phase) {
          <section class="phase" [class.active]="activePhase() === g.phase" (click)="activePhase.set(g.phase)">
            <header>
              <h2>{{ phaseLabel[g.phase] }}</h2>
              <span class="small muted">{{ g.list.length }} itens · {{ g.cost | number: '1.0-0' }} almas</span>
              @if (activePhase() === g.phase) {
                <span class="adding">adicionando aqui</span>
              }
            </header>
            @if (!g.list.length) {
              <p class="small muted hint">Clique aqui e depois nos itens da loja.</p>
            }
            <ol>
              @for (p of g.list; track p.slug; let first = $first; let last = $last) {
                <li [class]="'slot-' + p.info?.slot">
                  @if (p.info?.image_url) {
                    <img [src]="p.info!.image_url" alt="" width="36" height="36" />
                  }
                  <div class="row-main">
                    <strong>{{ p.info?.name ?? p.slug }}</strong>
                    <input
                      class="note"
                      type="text"
                      maxlength="120"
                      placeholder="Nota (opcional): quando comprar, por quê…"
                      [value]="p.note"
                      (input)="setNote(p.index, $any($event.target).value)"
                      (click)="$event.stopPropagation()"
                    />
                  </div>
                  <div class="row-actions" (click)="$event.stopPropagation()">
                    <button type="button" (click)="move(p.index, -1)" [disabled]="first" title="Subir">↑</button>
                    <button type="button" (click)="move(p.index, 1)" [disabled]="last" title="Descer">↓</button>
                    <select [value]="p.phase" (change)="setPhase(p.index, $any($event.target).value)" title="Mudar de fase">
                      @for (ph of phases; track ph) {
                        <option [value]="ph">{{ phaseLabel[ph] }}</option>
                      }
                    </select>
                    <button type="button" (click)="removeAt(p.index)" title="Tirar">✕</button>
                  </div>
                </li>
              }
            </ol>
          </section>
        }
      </div>

      <!-- Loja -->
      <aside class="shop">
        <h2>Loja <span class="small muted">({{ items().length }}/{{ maxItems }})</span></h2>
        <input class="input" type="search" placeholder="Buscar item…" [value]="query()" (input)="query.set($any($event.target).value)" />
        <div class="chips small-chips">
          <button type="button" [class.active]="!slot()" (click)="slot.set(null)">Todos</button>
          @for (s of slots; track s) {
            <button type="button" [class.active]="slot() === s" [class]="'chip-' + s" (click)="slot.set(s)">{{ slotLabel[s] }}</button>
          }
        </div>
        <div class="chips small-chips">
          <button type="button" [class.active]="!tier()" (click)="tier.set(null)">Tier</button>
          @for (t of [1, 2, 3, 4]; track t) {
            <button type="button" [class.active]="tier() === t" (click)="tier.set(t)">{{ t }}</button>
          }
        </div>
        <div class="shop-grid">
          @for (i of filteredShop(); track i.slug) {
            <button
              type="button"
              class="shop-item"
              [class]="'shop-item slot-' + i.slot"
              [class.used]="used().has(i.slug)"
              [disabled]="used().has(i.slug)"
              [title]="i.name + ' · ' + (i.cost ?? 0) + ' almas'"
              (click)="add(i)"
            >
              <img [src]="i.image_url" [alt]="i.name" width="44" height="44" loading="lazy" />
              <span>{{ i.name }}</span>
            </button>
          } @empty {
            <p class="small muted">Nenhum item com esse filtro.</p>
          }
        </div>
      </aside>
    </div>

    <label class="desc">
      <span>Como jogar com essa build (opcional)</span>
      <textarea class="input" rows="5" maxlength="3000" placeholder="Ordem das habilidades, quando trocar de item, contra quem funciona…" [value]="description()" (input)="description.set($any($event.target).value)"></textarea>
      <small class="muted">{{ description().length }}/3000</small>
    </label>

    <div class="actions">
      <button type="button" class="btn" (click)="save(true)" [disabled]="!canSave() || items().length < 3">
        {{ saving() ? 'Salvando…' : published() ? 'Salvar' : 'Publicar' }}
      </button>
      <button type="button" class="btn btn--ghost" (click)="save(false)" [disabled]="!canSave()">
        {{ published() ? 'Voltar para rascunho' : 'Salvar rascunho' }}
      </button>
      @if (items().length < 3) {
        <span class="small muted">Para publicar, coloque pelo menos 3 itens.</span>
      }
      @if (error(); as e) {
        <span class="msg" role="alert">{{ e }}</span>
      }
    </div>
  }
</section>
DDHUB_EOF
echo "ok  apps/web/src/app/features/builds/build-editor.html"

cat > 'apps/web/src/app/features/builds/build-editor.scss' <<'DDHUB_EOF'
.basics {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 16px;

  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13px;
    color: var(--muted);
  }

  .grow {
    flex: 1;
    min-width: 240px;
  }
}

.editor {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  gap: 16px;
  align-items: start;

  @media (max-width: 900px) {
    grid-template-columns: 1fr;
  }
}

.build {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.phase {
  padding: 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  cursor: pointer;

  &.active {
    border-color: var(--accent);
    box-shadow: inset 3px 0 0 var(--accent);
  }

  header {
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;

    h2 {
      margin: 0;
    }
  }

  .adding {
    margin-left: auto;
    font-size: 12px;
    color: var(--accent);
  }

  .hint {
    margin: 8px 0 0;
  }

  ol {
    list-style: none;
    margin: 8px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px;
    background: var(--bg);
    border: 1px solid var(--border);
    cursor: default;

    img {
      width: 36px;
      height: 36px;
      border-radius: 4px;
      flex: none;
      border-bottom: 3px solid transparent;
    }

    &.slot-weapon img { border-color: #e8913a; }
    &.slot-vitality img { border-color: #6fbf4a; }
    &.slot-spirit img { border-color: #a46cd8; }
  }
}

.row-main {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 0;

  strong {
    color: var(--text-strong);
    font-size: 14px;
  }
}

.note {
  width: 100%;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-size: 13px;
}

.row-actions {
  display: flex;
  gap: 4px;
  align-items: center;

  button,
  select {
    height: 28px;
    min-width: 28px;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: 13px;
    cursor: pointer;

    &:disabled {
      opacity: 0.35;
      cursor: default;
    }
  }

  select {
    padding: 0 4px;
  }
}

.shop {
  position: sticky;
  top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  max-height: calc(100vh - 24px);

  h2 {
    margin: 0;
  }

  @media (max-width: 900px) {
    position: static;
    max-height: none;
  }
}

.small-chips button {
  height: 30px;
  padding: 0 10px;
  font-size: 13px;
}

.shop-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(76px, 1fr));
  gap: 6px;
  overflow-y: auto;
  min-height: 200px;

  @media (max-width: 900px) {
    max-height: 420px;
  }
}

.shop-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 6px 2px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  font: inherit;
  font-size: 11px;
  line-height: 1.2;
  text-align: center;
  cursor: pointer;

  img {
    width: 44px;
    height: 44px;
    border-radius: 4px;
    border-bottom: 3px solid transparent;
  }

  &.slot-weapon img { border-color: #e8913a; }
  &.slot-vitality img { border-color: #6fbf4a; }
  &.slot-spirit img { border-color: #a46cd8; }

  span {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  &:hover:not(:disabled) {
    border-color: var(--accent);
  }

  &.used {
    opacity: 0.3;
    cursor: default;
  }
}

.desc {
  display: flex;
  flex-direction: column;
  gap: 4px;

  > span {
    font-weight: 600;
    color: var(--text-strong);
  }
}
DDHUB_EOF
echo "ok  apps/web/src/app/features/builds/build-editor.scss"

cat > 'apps/web/src/app/features/account/user-profile.ts' <<'DDHUB_EOF'
import { Component, computed, inject, input } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, startWith, switchMap } from 'rxjs';

import { AccountService, PublicProfile } from '../../core/services/account.service';
import { BuildCard as Build, BuildsService } from '../../core/services/builds.service';
import { BuildCard } from '../../shared/build-card/build-card';
import { AuthService } from '../../core/services/auth.service';

type State = { status: 'loading' } | { status: 'missing' } | { status: 'ok'; profile: PublicProfile };

/** Perfil público: /u/<@> */
@Component({
  selector: 'app-user-profile',
  imports: [DatePipe, RouterLink, BuildCard],
  template: `
    <section class="profile">
      @switch (state().status) {
        @case ('loading') {
          <p class="muted">Carregando perfil…</p>
        }
        @case ('missing') {
          <h1>Perfil não encontrado</h1>
          <p class="muted">Esse &#64; não existe ou a conta foi excluída.</p>
          <a routerLink="/">Voltar para o início</a>
        }
        @case ('ok') {
          @let p = profile()!;
          <header class="card">
            @if (p.avatar_url) {
              <img class="avatar" [src]="p.avatar_url" alt="" width="112" height="112" />
            } @else {
              <span class="avatar avatar--empty" aria-hidden="true">{{ p.display_name.charAt(0) }}</span>
            }
            <div class="who">
              <h1>
                {{ p.display_name }}
                @if (p.staff) {
                  <span class="staff">Equipe DDhub</span>
                }
              </h1>
              <p class="handle">&#64;{{ p.username }}</p>
              <p class="since">No DDhub desde {{ p.created_at | date: "MMMM 'de' y" }}</p>
              @if (p.bio) {
                <p class="bio">{{ p.bio }}</p>
              }
            </div>
            @if (isMe()) {
              <a class="edit" routerLink="/conta">Editar perfil</a>
            }
          </header>
          <section class="builds">
            <h2>Builds</h2>
            @if (builds() === null) {
              <p class="muted">Carregando…</p>
            } @else if (!builds()!.length) {
              <p class="muted">
                Nenhuma build publicada ainda.
                @if (isMe()) {
                  <a routerLink="/builds/nova">Criar a primeira →</a>
                }
              </p>
            } @else {
              <div class="grid">
                @for (b of builds(); track b.id) {
                  <app-build-card [build]="b" [showAuthor]="false" />
                }
              </div>
            }
          </section>
        }
      }
    </section>
  `,
  styles: `
    .profile { max-width: 860px; margin: 0 auto; padding: 32px 16px 48px; display: flex; flex-direction: column; gap: 16px; }
    .card { display: flex; gap: 20px; align-items: flex-start; padding: 24px; background: var(--surface); border: 1px solid var(--border); position: relative; }
    @media (max-width: 560px) { .card { flex-direction: column; } }
    .avatar { width: 112px; height: 112px; border-radius: 4px; object-fit: cover; flex: none; border: 2px solid var(--accent); }
    .avatar--empty { display: grid; place-items: center; background: var(--surface-sub); color: var(--accent); font-size: 48px; font-weight: 700; text-transform: uppercase; }
    .who { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    h1 { margin: 0; font-family: var(--font-display); color: var(--text-strong); display: flex; align-items: center; gap: 10px; flex-wrap: wrap; overflow-wrap: anywhere; }
    .staff { font-family: var(--font-cond); font-size: 12px; text-transform: uppercase; letter-spacing: .06em; padding: 3px 8px; background: var(--accent); color: var(--bg); }
    .handle { margin: 0; color: var(--accent); font-weight: 600; }
    .since { margin: 0; color: var(--muted); font-size: 14px; }
    .bio { margin: 8px 0 0; white-space: pre-line; color: var(--text); overflow-wrap: anywhere; }
    .edit { position: absolute; top: 20px; right: 20px; font-size: 14px; }
    @media (max-width: 560px) { .edit { position: static; } }
    .muted { color: var(--muted); }
    .builds h2 { margin: 8px 0 10px; font-family: var(--font-cond); font-size: 18px; text-transform: uppercase; letter-spacing: .04em; color: var(--text-strong); }
    .builds .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
  `,
})
export class UserProfile {
  private readonly accounts = inject(AccountService);
  private readonly buildsApi = inject(BuildsService);
  private readonly auth = inject(AuthService);

  /** Vem da rota /u/:username */
  readonly username = input.required<string>();

  protected readonly state = toSignal(
    toObservable(this.username).pipe(
      switchMap((u) =>
        this.accounts.profile(u).pipe(
          map((profile): State => ({ status: 'ok', profile })),
          catchError(() => of<State>({ status: 'missing' })),
          startWith<State>({ status: 'loading' }),
        ),
      ),
    ),
    { initialValue: { status: 'loading' } as State },
  );

  /** Builds publicadas da pessoa (null = carregando) */
  protected readonly builds = toSignal(
    toObservable(this.username).pipe(
      switchMap((u) =>
        this.buildsApi.byUser(u).pipe(
          map((r): Build[] | null => r.builds),
          catchError(() => of<Build[] | null>([])),
          startWith<Build[] | null>(null),
        ),
      ),
    ),
    { initialValue: null },
  );

  protected readonly profile = computed(() => {
    const s = this.state();
    return s.status === 'ok' ? s.profile : null;
  });

  protected readonly isMe = computed(() => {
    const me = this.auth.user();
    const p = this.profile();
    return !!me && !!p && me.username.toLowerCase() === p.username.toLowerCase();
  });
}
DDHUB_EOF
echo "ok  apps/web/src/app/features/account/user-profile.ts"

node - <<'JS'
const fs = require('fs');
let fail = 0;
function edit(p, find, repl, check) {
  let s = fs.readFileSync(p, 'utf8');
  if (s.includes(check)) return console.log('já estava  ' + p);
  if (!s.includes(find)) { console.error('NÃO ACHEI o trecho em ' + p + ': ' + find.slice(0, 60)); fail = 1; return; }
  fs.writeFileSync(p, s.replace(find, repl));
  console.log('editado  ' + p);
}
// ---------- API ----------
const app = 'apps/api/src/app.module.ts';
edit(app, "import { SearchModule } from './search/search.module.js';",
  "import { SearchModule } from './search/search.module.js';\nimport { BuildsModule } from './builds/builds.module.js';", 'builds/builds.module.js');
edit(app, '    SearchModule,\n', '    SearchModule,\n    BuildsModule,\n', '    BuildsModule,');

// ---------- Web: rotas (troca a página provisória) ----------
edit('apps/web/src/app/app.routes.ts', "  ...section('builds', 'Builds', 'id'),",
  `  {
    path: 'builds',
    title: 'Builds · DDhub',
    loadComponent: () => import('./features/builds/build-list').then((m) => m.BuildList),
  },
  {
    path: 'builds/nova',
    title: 'Nova build · DDhub',
    loadComponent: () => import('./features/builds/build-editor').then((m) => m.BuildEditor),
  },
  {
    path: 'builds/minhas',
    title: 'Minhas builds · DDhub',
    loadComponent: () => import('./features/builds/my-builds').then((m) => m.MyBuilds),
  },
  {
    path: 'builds/:id/editar',
    title: 'Editar build · DDhub',
    loadComponent: () => import('./features/builds/build-editor').then((m) => m.BuildEditor),
  },
  {
    path: 'builds/:id',
    title: 'Build · DDhub',
    loadComponent: () => import('./features/builds/build-detail').then((m) => m.BuildDetail),
  },`,
  "path: 'builds/nova'");

// ---------- Web: menu do avatar ----------
edit('apps/web/src/app/shared/user-menu/user-menu.ts',
  `                <a role="menuitem" class="account__item" routerLink="/conta" (click)="open.set(false)">Minha conta</a>`,
  `                <a role="menuitem" class="account__item" routerLink="/builds/minhas" (click)="open.set(false)">Minhas builds</a>
                <a role="menuitem" class="account__item" routerLink="/conta" (click)="open.set(false)">Minha conta</a>`,
  'Minhas builds</a>');

// ---------- Web: herói → builds da comunidade ----------
edit('apps/web/src/app/features/heroes/hero-detail/hero-detail.html',
  `              Itens mais comprados com este herói em cada fase da partida, com taxa de escolha e de vitória.
              Dados: Deadlock API.
            </p>`,
  `              Itens mais comprados com este herói em cada fase da partida, com taxa de escolha e de vitória.
              Dados: Deadlock API.
              <a [routerLink]="['/builds']" [queryParams]="{ heroi: h.slug }">Ver builds da comunidade →</a>
            </p>`,
  'Ver builds da comunidade');

// ---------- Web: aviso na exclusão de conta ----------
edit('apps/web/src/app/features/account/account-page.html',
  'Apaga <strong>na hora e para sempre</strong> o seu perfil, a ligação com a Steam e todas as sessões.',
  'Apaga <strong>na hora e para sempre</strong> o seu perfil, as suas builds, a ligação com a Steam e todas as sessões.',
  'as suas builds, a ligação');
process.exitCode = fail;
edit('apps/web/src/app/features/legal/legal-docs.ts',
  'A exclusão é imediata: apagamos o perfil, a ligação com a Steam e as sessões.',
  'A exclusão é imediata: apagamos o perfil, as suas builds e votos, a ligação com a Steam e as sessões.',
  'as suas builds e votos');
process.exitCode = fail;
JS

echo
echo "Conferência (esperado: 2 1 1 1 1 1 1):"
grep -c "BuildsModule" apps/api/src/app.module.ts
grep -c "path: 'builds/nova'" apps/web/src/app/app.routes.ts
grep -c "Minhas builds</a>" apps/web/src/app/shared/user-menu/user-menu.ts
grep -c "Ver builds da comunidade" apps/web/src/app/features/heroes/hero-detail/hero-detail.html
grep -c "as suas builds, a ligação" apps/web/src/app/features/account/account-page.html
grep -c "as suas builds e votos" apps/web/src/app/features/legal/legal-docs.ts
grep -c "app-build-card" apps/web/src/app/features/account/user-profile.ts
