#!/usr/bin/env bash
# Tier list / Meta (/meta) e "O que mudou no meu herói" (/o-que-mudou + aba Mudanças no herói)
# Rode na raiz do repositório:  cd ~/ddhub && bash aplicar-meta.sh
set -e
[ -d apps/api/src/game-data ] || { echo "Rode na raiz do repositório (cd ~/ddhub)."; exit 1; }
mkdir -p apps/web/src/app/shared/hero-changes apps/web/src/app/features/meta

cat > 'apps/api/src/game-data/tier-list.controller.ts' <<'DDHUB_EOF'
import { BadRequestException, Controller, Get, Logger, Query, ServiceUnavailableException } from '@nestjs/common';

import { SupabaseService } from '../supabase/supabase.service.js';
import { MemoryCache } from '../cache/memory-cache.service.js';
import { DEFAULT_DEADLOCK_API_URL } from './deadlock-api.client.js';

/** Dados de partidas mudam devagar: cada combinação de filtro é buscada no máximo a cada 3 horas. */
const TTL = 3 * 60 * 60 * 1000;
const FAIL_COOLDOWN = 10 * 60 * 1000;
/** Menos partidas que isso = amostra pequena demais para ganhar tier. */
const MIN_MATCHES = 200;
/** Partidas "imaginárias" a 50% somadas a cada herói (puxa amostras pequenas para o meio). */
const PRIOR = 400;

/** Filtros aceitos (poucos, para o cache não explodir e sermos bons vizinhos da API). */
export const BADGES: Record<string, { min: number; label: string }> = {
  '0': { min: 0, label: 'Todos os ranks' },
  '41': { min: 41, label: 'Arcanist+' },
  '61': { min: 61, label: 'Emissary+' },
  '81': { min: 81, label: 'Oracle+' },
  '91': { min: 91, label: 'Phantom+' },
  '101': { min: 101, label: 'Ascendant+' },
};
export const PERIODS = ['patch', '7d', '30d'] as const;
type Period = (typeof PERIODS)[number];

export type Tier = 'S' | 'A' | 'B' | 'C' | 'D';

export interface TierHero {
  slug: string;
  name: string;
  name_en: string | null;
  image: string | null;
  hero_type: string | null;
  matches: number;
  win_rate: number;
  pick_rate: number;
  /** Win rate ajustada pelo tamanho da amostra (o que decide o tier) */
  score: number;
  tier: Tier | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
}

export interface TierListResponse {
  since: string;
  period: Period;
  badge: string;
  badge_label: string;
  /** Partidas analisadas (cada partida tem 12 heróis) */
  games: number;
  updated_at: string;
  heroes: TierHero[];
}

type Row = Record<string, any>;

/**
 * GET /stats/tier-list?badge=91&period=patch
 * Tier list e meta: win rate, pick rate e KDA de cada herói (Deadlock API, partidas reais).
 * O tier sai da win rate ajustada, comparada com a média dos heróis (desvio padrão):
 *   S ≥ +1,2σ · A ≥ +0,4σ · B ≥ −0,4σ · C ≥ −1,2σ · D abaixo.
 */
@Controller('stats')
export class TierListController {
  private readonly logger = new Logger(TierListController.name);
  private readonly baseUrl = (process.env['DEADLOCK_API_URL'] ?? DEFAULT_DEADLOCK_API_URL).replace(/\/+$/, '');
  private readonly failedAt = new Map<string, number>();

  constructor(
    private readonly supabase: SupabaseService,
    private readonly cache: MemoryCache,
  ) {}

  @Get('tier-list')
  async tierList(@Query('badge') badgeParam?: string, @Query('period') periodParam?: string): Promise<TierListResponse> {
    const badge = badgeParam ?? '91';
    const period = (periodParam ?? 'patch') as Period;
    if (!BADGES[badge] || !PERIODS.includes(period)) throw new BadRequestException('Filtro inválido.');
    const key = `stats:tier:${badge}:${period}`;
    if (Date.now() - (this.failedAt.get(key) ?? 0) < FAIL_COOLDOWN) throw new ServiceUnavailableException('Dados de partidas indisponíveis agora. Tente mais tarde.');
    try {
      return await this.cache.get(key, TTL, () => this.load(badge, period));
    } catch (err) {
      this.failedAt.set(key, Date.now());
      this.logger.warn(`Tier list indisponível (${key}): ${String(err)}`);
      throw new ServiceUnavailableException('Dados de partidas indisponíveis agora. Tente mais tarde.');
    }
  }

  private async load(badge: string, period: Period): Promise<TierListResponse> {
    const since = await this.sinceDate(period);
    const params = new URLSearchParams({ min_unix_timestamp: String(Math.floor(since.getTime() / 1000)) });
    if (BADGES[badge].min > 0) params.set('min_average_badge', String(BADGES[badge].min));
    const res = await fetch(`${this.baseUrl}/v1/analytics/hero-stats?${params}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'DDhub/0.1 (portal da comunidade BR de Deadlock)' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = (await res.json()) as unknown;
    if (!Array.isArray(raw)) throw new Error('resposta não é uma lista');

    const totals = new Map<number, { wins: number; matches: number; k: number; d: number; a: number; kda: boolean }>();
    for (const r of raw as Row[]) {
      const id = Number(r['hero_id']);
      const wins = Number(r['wins'] ?? 0);
      const matches = Number(r['matches'] ?? wins + Number(r['losses'] ?? 0));
      if (!Number.isFinite(id) || !Number.isFinite(wins) || !Number.isFinite(matches) || matches <= 0) continue;
      const t = totals.get(id) ?? { wins: 0, matches: 0, k: 0, d: 0, a: 0, kda: true };
      t.wins += wins;
      t.matches += matches;
      const k = Number(r['total_kills']);
      const d = Number(r['total_deaths']);
      const a = Number(r['total_assists']);
      if ([k, d, a].every(Number.isFinite)) {
        t.k += k;
        t.d += d;
        t.a += a;
      } else t.kda = false;
      totals.set(id, t);
    }
    const allMatches = [...totals.values()].reduce((s, t) => s + t.matches, 0);
    if (!allMatches) throw new Error('sem partidas');
    const games = allMatches / 12;

    const { data, error } = await this.supabase.db.from('hero_cards').select('id, slug, name, name_en, hero_type, small_image');
    if (error) throw new Error('não foi possível ler os heróis');

    const heroes: TierHero[] = [];
    for (const h of (data ?? []) as Row[]) {
      const t = totals.get(Number(h['id']));
      if (!t) continue;
      const per = (v: number) => (t.kda ? Math.round((v / t.matches) * 10) / 10 : null);
      heroes.push({
        slug: h['slug'],
        name: h['name'],
        name_en: h['name_en'] ?? null,
        image: h['small_image'] ?? null,
        hero_type: h['hero_type'] ?? null,
        matches: t.matches,
        win_rate: round1((t.wins / t.matches) * 100),
        pick_rate: round1((t.matches / games) * 100),
        score: round1(((t.wins + PRIOR / 2) / (t.matches + PRIOR)) * 100),
        tier: null,
        kills: per(t.k),
        deaths: per(t.d),
        assists: per(t.a),
      });
    }

    const ranked = heroes.filter((h) => h.matches >= MIN_MATCHES);
    if (ranked.length < 5) throw new Error('poucos heróis com amostra suficiente');
    const mean = ranked.reduce((s, h) => s + h.score, 0) / ranked.length;
    const sd = Math.sqrt(ranked.reduce((s, h) => s + (h.score - mean) ** 2, 0) / ranked.length) || 1;
    for (const h of ranked) {
      const z = (h.score - mean) / sd;
      h.tier = z >= 1.2 ? 'S' : z >= 0.4 ? 'A' : z >= -0.4 ? 'B' : z >= -1.2 ? 'C' : 'D';
    }
    heroes.sort((a, b) => b.score - a.score);

    return {
      since: since.toISOString(),
      period,
      badge,
      badge_label: BADGES[badge].label,
      games: Math.round(games),
      updated_at: new Date().toISOString(),
      heroes,
    };
  }

  /** "patch": desde o último patch (se tiver menos de 3 dias, usa 7 dias). */
  private async sinceDate(period: Period): Promise<Date> {
    const days = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);
    if (period === '7d') return days(7);
    if (period === '30d') return days(30);
    const { data } = await this.supabase.db
      .from('patch_notes')
      .select('published_at')
      .eq('is_patch', true)
      .order('published_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const patch = data?.published_at ? new Date(data.published_at as string) : null;
    if (!patch || Date.now() - patch.getTime() < 3 * 24 * 60 * 60 * 1000) return days(7);
    return patch;
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
DDHUB_EOF
echo "ok  apps/api/src/game-data/tier-list.controller.ts"

cat > 'apps/api/src/news/hero-changes.controller.ts' <<'DDHUB_EOF'
import { BadRequestException, Controller, Get, InternalServerErrorException, NotFoundException, Param } from '@nestjs/common';

import { SupabaseService } from '../supabase/supabase.service.js';
import { MemoryCache, TTL } from '../cache/memory-cache.service.js';
import { steamToMarkdown, stripSteamMedia } from './steam-markup.js';

/** Quantos patches olhamos para trás. */
const PATCHES = 40;
/** Quantos patches com mudanças devolvemos por herói. */
const MAX_ENTRIES = 15;

export type ChangeKind = 'buff' | 'nerf' | 'ajuste';

export interface HeroChangeEntry {
  slug: string;
  title: string;
  published_at: string;
  translated: boolean;
  changes: { text: string; original: string | null; kind: ChangeKind | null }[];
}

export interface HeroChangesResponse {
  hero: { slug: string; name: string; name_en: string | null; image: string | null };
  entries: HeroChangeEntry[];
  patches_checked: number;
}

type Row = Record<string, any>;

interface Patch {
  gid: string;
  title: string;
  published_at: string;
  pt: string[] | null;
  en: string[];
}

/**
 * GET /changes/heroes/:slug — tudo o que mudou num herói nos últimos patches oficiais.
 * Nas notas da Valve cada mudança de herói vem numa linha "- Nome: mudança".
 * Pegamos essas linhas (em português quando já traduzido; o original fica junto).
 */
@Controller('changes')
export class HeroChangesController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly cache: MemoryCache,
  ) {}

  @Get('heroes/:slug')
  async hero(@Param('slug') slug: string): Promise<HeroChangesResponse> {
    if (!/^[a-z0-9-]{1,60}$/.test(slug ?? '')) throw new BadRequestException('Herói inválido.');
    return this.cache.get(`changes:hero:${slug}`, TTL.content, async () => {
      const { data: hero, error } = await this.supabase.db
        .from('hero_cards')
        .select('slug, name, name_en, small_image')
        .eq('slug', slug)
        .maybeSingle();
      if (error) throw new InternalServerErrorException('Não foi possível carregar o herói.');
      if (!hero) throw new NotFoundException('Herói não encontrado.');

      const patches = await this.patches();
      const names = [hero['name_en'], hero['name']].filter((n): n is string => typeof n === 'string' && n.trim().length >= 2);
      const entries: HeroChangeEntry[] = [];
      for (const p of patches) {
        const en = linesFor(p.en, names);
        const pt = p.pt ? linesFor(p.pt, names) : null;
        const shown = pt && pt.length ? pt : en;
        if (!shown.length) continue;
        // Mesma quantidade de linhas: dá para casar tradução com original (e classificar pelo inglês)
        const aligned = !pt || !pt.length || pt.length === en.length;
        entries.push({
          slug: `steam-${p.gid}`,
          title: p.title,
          published_at: p.published_at,
          translated: !!(pt && pt.length),
          changes: shown.map((text, i) => {
            const original = pt && pt.length && aligned ? (en[i] ?? null) : null;
            const source = pt && pt.length ? original : text;
            return { text, original, kind: source ? classify(source) : null };
          }),
        });
        if (entries.length >= MAX_ENTRIES) break;
      }
      return {
        hero: { slug: hero['slug'], name: hero['name'], name_en: hero['name_en'] ?? null, image: hero['small_image'] ?? null },
        entries,
        patches_checked: patches.length,
      };
    });
  }

  /** Os últimos patches, já convertidos em linhas (uma vez para todos os heróis). */
  private patches(): Promise<Patch[]> {
    return this.cache.get('changes:patches', TTL.content, async () => {
      const { data, error } = await this.supabase.db
        .from('patch_notes')
        .select('gid, title, title_pt, body_raw, body_pt_md, published_at')
        .eq('is_patch', true)
        .order('published_at', { ascending: false })
        .limit(PATCHES);
      if (error) throw new InternalServerErrorException('Não foi possível carregar os patches.');
      return ((data ?? []) as Row[]).map((p) => ({
        gid: p['gid'],
        title: p['title_pt'] || p['title'],
        published_at: p['published_at'],
        pt: p['body_pt_md'] ? stripSteamMedia(p['body_pt_md']).split('\n') : null,
        en: steamToMarkdown(p['body_raw'] ?? '').split('\n'),
      }));
    });
  }
}

/** Linhas "- Nome: mudança" desse herói (aceita "&", "and" e "e" em nomes como Mo & Krill). */
export function linesFor(lines: string[], names: string[]): string[] {
  const patterns = names.map((n) => {
    const escaped = n
      .trim()
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\s*&\s*/g, '\\s*(?:&|and|e)\\s*')
      .replace(/\s+/g, '\\s+');
    return new RegExp(`^\\s*(?:[-*•]\\s*)?(?:\\*\\*)?${escaped}(?:\\*\\*)?\\s*:\\s*(?:\\*\\*)?\\s*(.+)$`, 'i');
  });
  const out: string[] = [];
  for (const line of lines) {
    for (const re of patterns) {
      const m = line.match(re);
      if (m && m[1].trim()) {
        out.push(m[1].replace(/\*\*$/, '').trim());
        break;
      }
    }
  }
  return out;
}

/**
 * Buff ou nerf, olhando o texto em inglês. Heurística simples: em recarga, custo e
 * tempo de conjuração, "reduzido" é bom; nos outros atributos, "aumentado" é bom.
 * Quando não dá para saber (mudança de mecânica, correção), vira "ajuste".
 */
export function classify(en: string): ChangeKind {
  const s = en.toLowerCase();
  if (/^fixed\b|\bfixed\b|rework|replaced|now (has|uses|shows|plays)|updated (vfx|sfx|visual|model|animation)/.test(s)) return 'ajuste';
  const up = /\b(increased|improved|raised|buffed|extended)\b/.test(s);
  const down = /\b(reduced|decreased|lowered|nerfed|shortened)\b/.test(s);
  if (up === down) {
    if (/\bno longer\b|\bremoved\b/.test(s)) return 'ajuste';
    if (/\bnow also\b|\bnow grants\b|\badded\b/.test(s)) return 'buff';
    return 'ajuste';
  }
  const lowerIsBetter = /cooldown|\bcost\b|cast time|cast delay|windup|wind-up|charge time|spin-?up|reload time|recovery|lockout|self[- ]damage|channel time|startup/.test(s);
  if (lowerIsBetter) return down ? 'buff' : 'nerf';
  return up ? 'buff' : 'nerf';
}
DDHUB_EOF
echo "ok  apps/api/src/news/hero-changes.controller.ts"

cat > 'apps/web/src/app/core/services/meta.service.ts' <<'DDHUB_EOF'
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { API_BASE_URL } from '../api.config';

export type Tier = 'S' | 'A' | 'B' | 'C' | 'D';
export type MetaPeriod = 'patch' | '7d' | '30d';

export const META_BADGES: { value: string; label: string }[] = [
  { value: '0', label: 'Todos os ranks' },
  { value: '41', label: 'Arcanist+' },
  { value: '61', label: 'Emissary+' },
  { value: '81', label: 'Oracle+' },
  { value: '91', label: 'Phantom+' },
  { value: '101', label: 'Ascendant+' },
];

export const META_PERIODS: { value: MetaPeriod; label: string }[] = [
  { value: 'patch', label: 'Desde o patch' },
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
];

export interface TierHero {
  slug: string;
  name: string;
  name_en: string | null;
  image: string | null;
  hero_type: string | null;
  matches: number;
  win_rate: number;
  pick_rate: number;
  score: number;
  tier: Tier | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
}

export interface TierListResponse {
  since: string;
  period: MetaPeriod;
  badge: string;
  badge_label: string;
  games: number;
  updated_at: string;
  heroes: TierHero[];
}

export type ChangeKind = 'buff' | 'nerf' | 'ajuste';

export interface HeroChangeEntry {
  slug: string;
  title: string;
  published_at: string;
  translated: boolean;
  changes: { text: string; original: string | null; kind: ChangeKind | null }[];
}

export interface HeroChangesResponse {
  hero: { slug: string; name: string; name_en: string | null; image: string | null };
  entries: HeroChangeEntry[];
  patches_checked: number;
}

@Injectable({ providedIn: 'root' })
export class MetaService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_BASE_URL);

  tierList(badge: string, period: MetaPeriod): Observable<TierListResponse> {
    return this.http.get<TierListResponse>(`${this.api}/stats/tier-list`, { params: { badge, period } });
  }

  heroChanges(slug: string): Observable<HeroChangesResponse> {
    return this.http.get<HeroChangesResponse>(`${this.api}/changes/heroes/${encodeURIComponent(slug)}`);
  }
}
DDHUB_EOF
echo "ok  apps/web/src/app/core/services/meta.service.ts"

cat > 'apps/web/src/app/shared/hero-changes/hero-changes.ts' <<'DDHUB_EOF'
import { Component, computed, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, startWith, switchMap } from 'rxjs';

import { ChangeKind, HeroChangesResponse, MetaService } from '../../core/services/meta.service';

type State = { status: 'loading' } | { status: 'error' } | { status: 'ok'; data: HeroChangesResponse };

const KIND_LABEL: Record<ChangeKind, string> = { buff: 'Buff', nerf: 'Nerf', ajuste: 'Ajuste' };

/** Linha do tempo das mudanças de um herói nos patches oficiais. */
@Component({
  selector: 'app-hero-changes',
  imports: [DatePipe, RouterLink],
  template: `
    @switch (state().status) {
      @case ('loading') {
        <p class="muted">Procurando nos patches…</p>
      }
      @case ('error') {
        <p class="muted">Não deu para carregar as mudanças agora.</p>
      }
      @case ('ok') {
        @let d = data()!;
        @if (!d.entries.length) {
          <p class="muted">Nenhuma mudança para {{ d.hero.name }} nos últimos {{ d.patches_checked }} patches.</p>
        } @else {
          <div class="summary">
            <span><strong>{{ totals().buff }}</strong> buffs</span>
            <span><strong>{{ totals().nerf }}</strong> nerfs</span>
            <span><strong>{{ totals().ajuste }}</strong> ajustes</span>
            <span class="muted">em {{ d.entries.length }} patches</span>
            <label class="toggle">
              <input type="checkbox" [checked]="showOriginal()" (change)="showOriginal.set($any($event.target).checked)" />
              Mostrar original em inglês
            </label>
          </div>
          <ol class="timeline">
            @for (e of d.entries; track e.slug) {
              <li class="entry">
                <header>
                  <time [attr.datetime]="e.published_at">{{ e.published_at | date: 'dd/MM/yyyy' }}</time>
                  <a [routerLink]="['/noticias', e.slug]">{{ e.title }}</a>
                </header>
                <ul>
                  @for (c of e.changes; track $index) {
                    <li>
                      @if (c.kind) {
                        <span class="kind" [class]="'kind kind--' + c.kind">{{ kindLabel[c.kind] }}</span>
                      }
                      <span class="text">
                        {{ c.text }}
                        @if (showOriginal() && c.original) {
                          <small>{{ c.original }}</small>
                        }
                      </span>
                    </li>
                  }
                </ul>
              </li>
            }
          </ol>
          <p class="note">
            Fonte: notas de atualização oficiais da Valve, traduzidas pelo DDhub. Buff/nerf é uma estimativa automática.
          </p>
        }
      }
    }
  `,
  styles: `
    :host { display: block; }
    .muted { color: var(--muted); }
    .summary { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; margin-bottom: 14px; font-size: 14px; }
    .summary strong { color: var(--text-strong); font-size: 18px; }
    .toggle { margin-left: auto; display: inline-flex; align-items: center; gap: 6px; color: var(--muted); cursor: pointer; }
    .timeline { list-style: none; margin: 0; padding: 0 0 0 16px; border-left: 2px solid var(--border); display: flex; flex-direction: column; gap: 18px; }
    .entry { position: relative; }
    .entry::before { content: ''; position: absolute; left: -23px; top: 6px; width: 12px; height: 12px; border-radius: 50%; background: var(--accent); }
    .entry header { display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: baseline; margin-bottom: 8px; }
    .entry time { font-family: var(--font-cond); font-weight: 700; color: var(--accent); }
    .entry header a { color: var(--text-strong); font-weight: 600; }
    .entry ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .entry ul li { display: flex; gap: 10px; align-items: flex-start; padding: 8px 10px; background: var(--surface); border: 1px solid var(--border); }
    .kind { flex: none; min-width: 52px; text-align: center; font-family: var(--font-cond); font-size: 12px; font-weight: 700; text-transform: uppercase; padding: 2px 6px; }
    .kind--buff { background: color-mix(in srgb, var(--win) 22%, transparent); color: var(--win); }
    .kind--nerf { background: color-mix(in srgb, var(--live) 22%, transparent); color: var(--live); }
    .kind--ajuste { background: var(--surface-sub); color: var(--muted); }
    .text { display: flex; flex-direction: column; gap: 2px; }
    .text small { color: var(--muted); font-size: 12px; }
    .note { margin: 16px 0 0; font-size: 12px; color: var(--faint); }
  `,
})
export class HeroChanges {
  private readonly meta = inject(MetaService);
  readonly slug = input.required<string>();

  protected readonly kindLabel = KIND_LABEL;
  protected readonly showOriginal = signal(false);

  protected readonly state = toSignal(
    toObservable(this.slug).pipe(
      switchMap((s) =>
        this.meta.heroChanges(s).pipe(
          map((data): State => ({ status: 'ok', data })),
          catchError(() => of<State>({ status: 'error' })),
          startWith<State>({ status: 'loading' }),
        ),
      ),
    ),
    { initialValue: { status: 'loading' } as State },
  );

  protected readonly data = computed(() => {
    const s = this.state();
    return s.status === 'ok' ? s.data : null;
  });

  protected readonly totals = computed(() => {
    const t = { buff: 0, nerf: 0, ajuste: 0 };
    for (const e of this.data()?.entries ?? []) for (const c of e.changes) if (c.kind) t[c.kind]++;
    return t;
  });
}
DDHUB_EOF
echo "ok  apps/web/src/app/shared/hero-changes/hero-changes.ts"

cat > 'apps/web/src/app/features/meta/tier-list.ts' <<'DDHUB_EOF'
import { Component, computed, inject, input } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, combineLatest, map, of, startWith, switchMap } from 'rxjs';

import { META_BADGES, META_PERIODS, MetaPeriod, MetaService, Tier, TierHero, TierListResponse } from '../../core/services/meta.service';
import { NamePreferenceService } from '../../core/services/name-preference.service';

type State = { status: 'loading' } | { status: 'error' } | { status: 'ok'; data: TierListResponse };
type SortKey = 'score' | 'win_rate' | 'pick_rate' | 'matches' | 'kda';

const TIERS: { tier: Tier; hint: string }[] = [
  { tier: 'S', hint: 'Muito acima da média' },
  { tier: 'A', hint: 'Acima da média' },
  { tier: 'B', hint: 'Na média' },
  { tier: 'C', hint: 'Abaixo da média' },
  { tier: 'D', hint: 'Muito abaixo da média' },
];

/** /meta — tier list e tabela do meta, com filtro de rank e período (?rank=91&periodo=patch). */
@Component({
  selector: 'app-tier-list',
  imports: [DatePipe, DecimalPipe, RouterLink],
  templateUrl: './tier-list.html',
  styleUrl: './tier-list.scss',
})
export class TierList {
  private readonly meta = inject(MetaService);
  private readonly router = inject(Router);
  protected readonly names = inject(NamePreferenceService);

  /** Da URL */
  readonly rank = input<string | undefined>();
  readonly periodo = input<string | undefined>();
  readonly ordem = input<string | undefined>();

  protected readonly badges = META_BADGES;
  protected readonly periods = META_PERIODS;
  protected readonly tiers = TIERS;

  protected readonly badge = computed(() => (META_BADGES.some((b) => b.value === this.rank()) ? this.rank()! : '91'));
  protected readonly period = computed<MetaPeriod>(() =>
    META_PERIODS.some((p) => p.value === this.periodo()) ? (this.periodo() as MetaPeriod) : 'patch',
  );
  protected readonly sort = computed<SortKey>(() =>
    (['score', 'win_rate', 'pick_rate', 'matches', 'kda'] as const).includes(this.ordem() as SortKey) ? (this.ordem() as SortKey) : 'score',
  );

  protected readonly state = toSignal(
    combineLatest([toObservable(this.badge), toObservable(this.period)]).pipe(
      switchMap(([b, p]) =>
        this.meta.tierList(b, p).pipe(
          map((data): State => ({ status: 'ok', data })),
          catchError(() => of<State>({ status: 'error' })),
          startWith<State>({ status: 'loading' }),
        ),
      ),
    ),
    { initialValue: { status: 'loading' } as State },
  );

  protected readonly data = computed(() => {
    const s = this.state();
    return s.status === 'ok' ? s.data : null;
  });

  protected readonly byTier = computed(() => {
    const groups = new Map<Tier, TierHero[]>(TIERS.map((t) => [t.tier, []]));
    for (const h of this.data()?.heroes ?? []) if (h.tier) groups.get(h.tier)!.push(h);
    return groups;
  });

  protected readonly unranked = computed(() => (this.data()?.heroes ?? []).filter((h) => !h.tier));

  protected readonly rows = computed(() => {
    const key = this.sort();
    const val = (h: TierHero) => (key === 'kda' ? this.kda(h) ?? -1 : h[key]);
    return [...(this.data()?.heroes ?? [])].sort((a, b) => val(b) - val(a));
  });

  protected kda(h: TierHero): number | null {
    if (h.kills == null || h.deaths == null || h.assists == null) return null;
    return Math.round(((h.kills + h.assists) / Math.max(h.deaths, 1)) * 100) / 100;
  }

  protected setFilter(key: 'rank' | 'periodo' | 'ordem', value: string): void {
    void this.router.navigate([], { queryParams: { [key]: value }, queryParamsHandling: 'merge', replaceUrl: true });
  }
}
DDHUB_EOF
echo "ok  apps/web/src/app/features/meta/tier-list.ts"

cat > 'apps/web/src/app/features/meta/tier-list.html' <<'DDHUB_EOF'
<section class="meta container">
  <header class="head">
    <div>
      <p class="kicker">Meta</p>
      <h1>Tier list do Deadlock</h1>
      <p class="sub">Win rate e pick rate de cada herói em partidas reais. Atualiza a cada 3 horas.</p>
    </div>
    <a class="changes-link" routerLink="/o-que-mudou">O que mudou no meu herói →</a>
  </header>

  <div class="filters">
    <label>
      <span>Rank</span>
      <select [value]="badge()" (change)="setFilter('rank', $any($event.target).value)">
        @for (b of badges; track b.value) {
          <option [value]="b.value">{{ b.label }}</option>
        }
      </select>
    </label>
    <div class="chips" role="group" aria-label="Período">
      @for (p of periods; track p.value) {
        <button type="button" [class.active]="period() === p.value" (click)="setFilter('periodo', p.value)">{{ p.label }}</button>
      }
    </div>
  </div>

  @switch (state().status) {
    @case ('loading') {
      <p class="muted">Calculando o meta…</p>
    }
    @case ('error') {
      <p class="muted">Os dados de partidas estão indisponíveis agora. Tente de novo em alguns minutos.</p>
    }
    @case ('ok') {
      @let d = data()!;
      <p class="context">
        <strong>{{ d.games | number: '1.0-0' }}</strong> partidas {{ d.badge_label }} desde {{ d.since | date: 'dd/MM' }}.
      </p>

      <!-- Tiers -->
      <div class="tiers">
        @for (t of tiers; track t.tier) {
          <div class="tier" [class]="'tier tier--' + t.tier">
            <div class="tier__label">
              <strong>{{ t.tier }}</strong>
              <small>{{ t.hint }}</small>
            </div>
            <div class="tier__heroes">
              @for (h of byTier().get(t.tier); track h.slug) {
                <a class="pick" [routerLink]="['/herois', h.slug]" [title]="names.primary(h.name, h.name_en) + ' · ' + h.win_rate + '% de vitória'">
                  @if (h.image) {
                    <img [src]="h.image" [alt]="names.primary(h.name, h.name_en)" width="64" height="64" loading="lazy" />
                  }
                  <span class="pick__name">{{ names.primary(h.name, h.name_en) }}</span>
                  <span class="pick__wr">{{ h.win_rate | number: '1.1-1' }}%</span>
                </a>
              } @empty {
                <span class="muted small">—</span>
              }
            </div>
          </div>
        }
      </div>
      @if (unranked().length) {
        <p class="muted small">
          Poucas partidas para ranquear:
          @for (h of unranked(); track h.slug; let last = $last) {
            {{ names.primary(h.name, h.name_en) }}{{ last ? '.' : ',' }}
          }
        </p>
      }

      <!-- Tabela -->
      <h2>Todos os heróis</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Herói</th>
              <th>Tier</th>
              <th><button type="button" [class.on]="sort() === 'win_rate'" (click)="setFilter('ordem', 'win_rate')">Vitória</button></th>
              <th><button type="button" [class.on]="sort() === 'pick_rate'" (click)="setFilter('ordem', 'pick_rate')">Escolha</button></th>
              <th><button type="button" [class.on]="sort() === 'kda'" (click)="setFilter('ordem', 'kda')">KDA</button></th>
              <th><button type="button" [class.on]="sort() === 'matches'" (click)="setFilter('ordem', 'matches')">Partidas</button></th>
            </tr>
          </thead>
          <tbody>
            @for (h of rows(); track h.slug; let i = $index) {
              <tr>
                <td class="num">{{ i + 1 }}</td>
                <td>
                  <a class="hero" [routerLink]="['/herois', h.slug]">
                    @if (h.image) {
                      <img [src]="h.image" alt="" width="32" height="32" loading="lazy" />
                    }
                    {{ names.primary(h.name, h.name_en) }}
                  </a>
                </td>
                <td><span class="badge" [class]="'badge badge--' + (h.tier ?? 'none')">{{ h.tier ?? '–' }}</span></td>
                <td class="num">
                  <span class="bar"><span [style.width.%]="(h.win_rate - 40) * 5"></span></span>
                  {{ h.win_rate | number: '1.1-1' }}%
                </td>
                <td class="num">{{ h.pick_rate | number: '1.1-1' }}%</td>
                <td class="num" [title]="h.kills != null ? h.kills + ' / ' + h.deaths + ' / ' + h.assists : ''">
                  {{ kda(h) != null ? (kda(h) | number: '1.2-2') : '–' }}
                </td>
                <td class="num">{{ h.matches | number: '1.0-0' }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      <p class="note">
        Como o tier é calculado: a win rate de cada herói é ajustada pelo tamanho da amostra e comparada com a média dos
        outros heróis. Pick rate = em quantas partidas o herói apareceu. KDA = (abates + assistências) ÷ mortes, por partida.
        Dados: <a href="https://deadlock-api.com" target="_blank" rel="noopener">Deadlock API</a> · Deadlock é marca da Valve.
      </p>
    }
  }
</section>
DDHUB_EOF
echo "ok  apps/web/src/app/features/meta/tier-list.html"

cat > 'apps/web/src/app/features/meta/tier-list.scss' <<'DDHUB_EOF'
.meta {
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
}

h2 {
  margin: 16px 0 0;
  font-family: var(--font-display);
  color: var(--text-strong);
}

.sub,
.context {
  margin: 0;
  color: var(--muted);
  font-size: 14px;

  strong {
    color: var(--text-strong);
  }
}

.changes-link {
  font-weight: 600;
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

  select {
    height: 38px;
    padding: 0 10px;
    border: 1px solid var(--border);
    border-radius: 2px;
    background: var(--surface);
    color: var(--text-strong);
    font: inherit;
  }
}

.chips {
  display: flex;
  gap: 6px;

  button {
    height: 38px;
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

.tiers {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.tier {
  display: grid;
  grid-template-columns: 110px 1fr;
  background: var(--surface);
  border: 1px solid var(--border);

  &__label {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    gap: 2px;
    padding: 10px;
    text-align: center;
    color: var(--bg);

    strong {
      font-family: var(--font-display);
      font-size: 40px;
      line-height: 1;
    }

    small {
      font-size: 11px;
      font-weight: 600;
      opacity: 0.85;
    }
  }

  &__heroes {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 10px;
    align-items: center;
  }

  &--S .tier__label { background: #ff7a1a; }
  &--A .tier__label { background: #f5b83d; }
  &--B .tier__label { background: #7cc46a; }
  &--C .tier__label { background: #5aa2d6; }
  &--D .tier__label { background: #8a7fc2; }

  @media (max-width: 560px) {
    grid-template-columns: 64px 1fr;

    small {
      display: none;
    }
  }
}

.pick {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 72px;
  gap: 2px;
  color: var(--text);
  text-decoration: none;

  img {
    width: 64px;
    height: 64px;
    object-fit: cover;
    border-radius: 4px;
    background: var(--bg-deep);
    transition: transform 0.15s ease;
  }

  &:hover img {
    transform: translateY(-2px);
  }

  &__name {
    max-width: 72px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
  }

  &__wr {
    font-size: 11px;
    color: var(--muted);
  }
}

.table-wrap {
  overflow-x: auto;
  border: 1px solid var(--border);
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;

  th,
  td {
    padding: 8px 12px;
    text-align: left;
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
  }

  thead th {
    background: var(--surface-head);
    font-family: var(--font-cond);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-size: 13px;
    color: var(--muted);

    button {
      border: 0;
      padding: 0;
      background: none;
      color: inherit;
      font: inherit;
      text-transform: inherit;
      letter-spacing: inherit;
      cursor: pointer;

      &.on,
      &:hover {
        color: var(--accent);
      }
    }
  }

  tbody tr:nth-child(even) {
    background: var(--surface);
  }

  .num {
    font-variant-numeric: tabular-nums;
  }
}

.hero {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: var(--text-strong);
  text-decoration: none;

  img {
    width: 32px;
    height: 32px;
    border-radius: 4px;
    object-fit: cover;
  }
}

.badge {
  display: inline-block;
  min-width: 26px;
  text-align: center;
  padding: 2px 6px;
  font-family: var(--font-cond);
  font-weight: 700;
  color: var(--bg);

  &--S { background: #ff7a1a; }
  &--A { background: #f5b83d; }
  &--B { background: #7cc46a; }
  &--C { background: #5aa2d6; }
  &--D { background: #8a7fc2; }
  &--none { background: var(--surface-sub); color: var(--muted); }
}

.bar {
  display: inline-block;
  width: 60px;
  height: 6px;
  margin-right: 8px;
  background: var(--surface-sub);
  vertical-align: middle;

  span {
    display: block;
    height: 100%;
    max-width: 100%;
    background: var(--accent);
  }
}

.muted {
  color: var(--muted);
}

.small {
  font-size: 13px;
}

.note {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--faint);
}
DDHUB_EOF
echo "ok  apps/web/src/app/features/meta/tier-list.scss"

cat > 'apps/web/src/app/features/meta/what-changed.ts' <<'DDHUB_EOF'
import { Component, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';

import { HeroesService } from '../../core/services/heroes.service';
import { NamePreferenceService } from '../../core/services/name-preference.service';
import { HeroChanges } from '../../shared/hero-changes/hero-changes';

const STORE = 'ddhub.meuHeroi';

/** /o-que-mudou?heroi=<slug> — escolhe o herói e vê tudo o que mudou nele nos patches. */
@Component({
  selector: 'app-what-changed',
  imports: [RouterLink, HeroChanges],
  template: `
    <section class="container page">
      <header>
        <p class="kicker">Patches</p>
        <h1>O que mudou no meu herói?</h1>
        <p class="sub">Escolha o herói e veja buffs, nerfs e ajustes de cada atualização, já em português.</p>
      </header>

      <input
        class="search"
        type="search"
        placeholder="Filtrar heróis…"
        [value]="query()"
        (input)="query.set($any($event.target).value)"
        aria-label="Filtrar heróis"
      />
      <div class="grid" role="list">
        @for (h of filtered(); track h.slug) {
          <button type="button" role="listitem" class="pick" [class.active]="h.slug === selected()" (click)="choose(h.slug)">
            @if (h.small_image) {
              <img [src]="h.small_image" alt="" width="56" height="56" loading="lazy" />
            }
            <span>{{ names.primary(h.name, h.name_en) }}</span>
          </button>
        }
      </div>

      @if (selectedHero(); as h) {
        <div class="chosen">
          <h2>{{ names.primary(h.name, h.name_en) }}</h2>
          <a [routerLink]="['/herois', h.slug]">Página do herói →</a>
          <a routerLink="/meta">Ver a tier list →</a>
        </div>
        <app-hero-changes [slug]="h.slug" />
      } @else {
        <p class="muted">Escolha um herói acima. O DDhub lembra a sua escolha na próxima visita.</p>
      }
    </section>
  `,
  styles: `
    .page { padding-top: 28px; padding-bottom: 48px; display: flex; flex-direction: column; gap: 16px; }
    .kicker { margin: 0; font-family: var(--font-cond); text-transform: uppercase; letter-spacing: .08em; font-size: 13px; color: var(--accent); }
    h1 { margin: 2px 0 4px; font-family: var(--font-display); color: var(--text-strong); }
    .sub, .muted { margin: 0; color: var(--muted); }
    .search { max-width: 320px; height: 40px; padding: 0 12px; border: 1px solid var(--border); border-radius: 2px; background: var(--surface); color: var(--text-strong); font: inherit; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(84px, 1fr)); gap: 8px; }
    .pick {
      display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 8px 4px;
      border: 1px solid var(--border); background: var(--surface); color: var(--text); font: inherit; font-size: 12px; cursor: pointer;
    }
    .pick img { width: 56px; height: 56px; object-fit: cover; border-radius: 4px; }
    .pick span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pick:hover { border-color: var(--accent-soft); }
    .pick.active { border-color: var(--accent); background: var(--accent-soft); color: var(--text-strong); }
    .chosen { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px 16px; margin-top: 8px; }
    .chosen h2 { margin: 0; font-family: var(--font-display); color: var(--text-strong); }
  `,
})
export class WhatChanged {
  private readonly router = inject(Router);
  protected readonly names = inject(NamePreferenceService);

  /** Da URL (?heroi=haze) */
  readonly heroi = input<string | undefined>();

  protected readonly query = signal('');
  private readonly heroes = toSignal(inject(HeroesService).list().pipe(catchError(() => of([]))), { initialValue: [] });

  /** URL primeiro; se não tiver, o último herói escolhido neste navegador. */
  protected readonly selected = computed(() => this.heroi() ?? readStored());
  protected readonly selectedHero = computed(() => this.heroes().find((h) => h.slug === this.selected()) ?? null);

  protected readonly filtered = computed(() => {
    const q = norm(this.query());
    return this.heroes()
      .filter((h) => !q || norm(h.name).includes(q) || norm(h.name_en ?? '').includes(q))
      .sort((a, b) => this.names.primary(a.name, a.name_en).localeCompare(this.names.primary(b.name, b.name_en), 'pt-BR'));
  });

  protected choose(slug: string): void {
    try {
      localStorage.setItem(STORE, slug);
    } catch {
      /* sem armazenamento */
    }
    void this.router.navigate([], { queryParams: { heroi: slug }, replaceUrl: true });
  }
}

function readStored(): string | null {
  try {
    return localStorage.getItem(STORE);
  } catch {
    return null;
  }
}

function norm(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}
DDHUB_EOF
echo "ok  apps/web/src/app/features/meta/what-changed.ts"

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
const gd = 'apps/api/src/game-data/game-data.module.ts';
edit(gd, "import { HeroStatsController } from './hero-stats.controller.js';",
  "import { HeroStatsController } from './hero-stats.controller.js';\nimport { TierListController } from './tier-list.controller.js';", 'tier-list.controller.js');
edit(gd, 'MapController, HeroStatsController],', 'MapController, HeroStatsController, TierListController],', 'HeroStatsController, TierListController]');
const nm = 'apps/api/src/news/news.module.ts';
edit(nm, "import { NewsController } from './news.controller.js';",
  "import { NewsController } from './news.controller.js';\nimport { HeroChangesController } from './hero-changes.controller.js';", 'hero-changes.controller.js');
edit(nm, 'controllers: [NewsController, NewsAdminController],', 'controllers: [NewsController, NewsAdminController, HeroChangesController],', 'NewsAdminController, HeroChangesController]');

// ---------- Web: rotas ----------
edit('apps/web/src/app/app.routes.ts',
  "  {\n    path: 'diario',",
  "  {\n    path: 'meta',\n    title: 'Tier list e meta · DDhub',\n    loadComponent: () => import('./features/meta/tier-list').then((m) => m.TierList),\n  },\n  { path: 'tier-list', redirectTo: 'meta' },\n  {\n    path: 'o-que-mudou',\n    title: 'O que mudou no meu herói · DDhub',\n    loadComponent: () => import('./features/meta/what-changed').then((m) => m.WhatChanged),\n  },\n  {\n    path: 'diario',",
  "path: 'o-que-mudou'");

// ---------- Web: menu ----------
edit('apps/web/src/app/layout/header/header.ts',
  "        { label: 'Itens', path: '/itens', hint: 'A loja completa, por tier' },",
  "        { label: 'Itens', path: '/itens', hint: 'A loja completa, por tier' },\n        { label: 'Tier list / Meta', path: '/meta', hint: 'Win rate e pick rate por rank' },\n        { label: 'O que mudou no meu herói', path: '/o-que-mudou', hint: 'Buffs e nerfs de cada patch' },",
  "path: '/meta'");

// ---------- Web: home (card "Meta" vai para a tier list) ----------
edit('apps/web/src/app/features/home/home.ts',
  "        text: `${hero.name} tem o maior win rate no ${this.heroStats().badge} desde o patch`,\n        link: `/herois/${hero.slug}`,",
  "        text: `${hero.name} tem o maior win rate no ${this.heroStats().badge} desde o patch. Veja a tier list`,\n        link: '/meta',",
  'Veja a tier list');

// ---------- Web: aba "Mudanças" no herói ----------
const hd = 'apps/web/src/app/features/heroes/hero-detail/hero-detail';
edit(hd + '.ts', "type Tab = 'overview' | 'guide' | 'abilities' | 'items' | 'lore';", "type Tab = 'overview' | 'guide' | 'abilities' | 'items' | 'changes' | 'lore';", "'items' | 'changes'");
edit(hd + '.ts', "    { id: 'items', label: 'Itens populares' },", "    { id: 'items', label: 'Itens populares' },\n    { id: 'changes', label: 'Mudanças' },", "id: 'changes'");
edit(hd + '.ts', "import { Markdown } from '../../../shared/markdown/markdown';", "import { Markdown } from '../../../shared/markdown/markdown';\nimport { HeroChanges } from '../../../shared/hero-changes/hero-changes';", 'shared/hero-changes/hero-changes');
edit(hd + '.ts', 'imports: [RouterLink, Markdown],', 'imports: [RouterLink, Markdown, HeroChanges],', 'Markdown, HeroChanges]');
edit(hd + '.html', "          @case ('lore') {",
  "          @case ('changes') {\n            <section class=\"box\">\n              <h2 class=\"box__title\">O que mudou nos últimos patches</h2>\n              <app-hero-changes [slug]=\"h.slug\" />\n            </section>\n          }\n\n          @case ('lore') {",
  "@case ('changes')");
process.exitCode = fail;
JS

echo
echo "Conferência (esperado: 2 2 1 1 1 2):"
grep -c "TierListController" apps/api/src/game-data/game-data.module.ts
grep -c "HeroChangesController" apps/api/src/news/news.module.ts
grep -c "path: 'o-que-mudou'" apps/web/src/app/app.routes.ts
grep -c "path: '/meta'" apps/web/src/app/layout/header/header.ts
grep -c "link: '/meta'" apps/web/src/app/features/home/home.ts
grep -c "changes" apps/web/src/app/features/heroes/hero-detail/hero-detail.html
