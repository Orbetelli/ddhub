#!/usr/bin/env bash
# DDhub Diário: 4 modos (Habilidade, Item, Mob, Mapa) em /diario
# Rode na raiz do repositório:  cd ~/ddhub && bash aplicar-diario.sh
set -e
[ -d apps/api/src/daily ] || { echo "Rode na raiz do repositório (cd ~/ddhub)."; exit 1; }
mkdir -p apps/web/src/app/features/daily

cat > 'apps/api/src/daily/daily.controller.ts' <<'DDHUB_EOF'
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import { createHash } from 'node:crypto';

import { SupabaseService } from '../supabase/supabase.service.js';
import { MemoryCache, TTL } from '../cache/memory-cache.service.js';
import { MapController } from '../game-data/map.controller.js';

/** Dia 1 do jogo (os números "#12" contam a partir daqui). */
const LAUNCH = '2026-11-23';
export const MAX_GUESSES = 6;
const MAP_GUESSES = 5;
/** Acerto no mapa: até 5% da largura do mapa do ponto certo. */
const MAP_HIT = 0.05;

export type Mode = 'habilidade' | 'item' | 'mob' | 'mapa';
const MODES: Mode[] = ['habilidade', 'item', 'mob', 'mapa'];

const TYPE_LABEL: Record<string, string> = { assassin: 'Assassino', brawler: 'Lutador', marksman: 'Atirador', mystic: 'Místico' };
const SLOT_LABEL: Record<number, string> = { 1: '1ª habilidade', 2: '2ª habilidade', 3: '3ª habilidade', 4: 'Ultimate' };
const ITEM_SLOT: Record<string, string> = { weapon: 'Arma (laranja)', vitality: 'Vitalidade (verde)', spirit: 'Espiritual (roxo)' };
const MARKER_LABEL: Record<string, string> = {
  guardiao: 'Guardião',
  andador: 'Andador',
  'guardiao-base': 'Guardião da base',
  santuario: 'Santuário',
  patrono: 'Patrono',
  'chefe-meio': 'Chefe do Meio',
  base: 'Base',
};
const CAMP_LABEL: Record<string, string> = { pequeno: 'Acampamento pequeno', medio: 'Acampamento médio', grande: 'Acampamento grande', cofre: 'Cofre' };

type Row = Record<string, any>;

interface Option {
  slug: string;
  name: string;
  name_en?: string | null;
  image?: string | null;
}

/** Desafio de escolha (habilidade, item, mob): a pessoa escolhe uma opção da lista. */
interface ChoicePuzzle {
  answer: string;
  answerName: string;
  /** Imagem real (só o servidor sabe; o site recebe por /daily/:modo/image) */
  imageUrl: string;
  /** Dicas liberadas conforme os erros */
  hints: (wrong: number) => string[];
  /** O que mostrar no fim */
  reveal: Record<string, unknown>;
  /** Ponto do zoom (item), em fração da imagem */
  focus?: { x: number; y: number };
}

interface MapPuzzle {
  x: number;
  y: number;
  label: string;
  image: string;
}

/**
 * DDhub Diário: 4 desafios por dia, iguais para todo mundo, trocam à meia-noite de Brasília.
 *   GET  /daily/:modo          → dados públicos do desafio (sem a resposta)
 *   GET  /daily/:modo/image    → a imagem do desafio (o endereço original entregaria o nome)
 *   POST /daily/:modo/guess    → confere o palpite; a resposta só vem no fim
 * Modos: habilidade · item · mob · mapa.  GET /daily = habilidade (compatibilidade).
 */
@Controller('daily')
export class DailyController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly cache: MemoryCache,
    private readonly map: MapController,
  ) {}

  /** Compatibilidade com a primeira versão do jogo (só habilidade). */
  @Get()
  async legacy() {
    const data = await this.today('habilidade');
    const p = (await this.choice('habilidade', today().day)) as ChoicePuzzle;
    return { ...data, icon: p.imageUrl, heroes: data.options };
  }

  /** Compatibilidade: POST /daily/guess { hero, wrong } (1ª versão, só habilidade). */
  @Post('guess')
  @HttpCode(200)
  legacyGuess(@Body() body: { hero?: unknown; wrong?: unknown }) {
    return this.guess('habilidade', { hero: body?.hero, wrong: body?.wrong });
  }

  @Get(':mode')
  async today(@Param('mode') modeParam: string) {
    const mode = parseMode(modeParam);
    const { day, number } = today();
    const base = { mode, number, date: day, next_at: nextMidnightSaoPaulo() };

    if (mode === 'mapa') {
      const p = await this.mapPuzzle(day);
      // O recorte precisa do centro para ser desenhado; o rótulo do lugar só vem no fim
      return { ...base, max_guesses: MAP_GUESSES, map_image: p.image, focus: { x: p.x, y: p.y } };
    }

    const p = await this.choice(mode, day);
    return {
      ...base,
      max_guesses: MAX_GUESSES,
      image: `/daily/${mode}/image?d=${day}`,
      focus: p.focus ?? null,
      options: await this.options(mode),
    };
  }

  @Get(':mode/image')
  async image(@Param('mode') modeParam: string, @Res() res: { setHeader(n: string, v: string): void; send(b: Buffer): void }) {
    const mode = parseMode(modeParam);
    if (mode === 'mapa') throw new NotFoundException();
    const { day } = today();
    const p = await this.choice(mode, day);
    const img = await this.cache.get(`daily:img:${mode}:${day}`, TTL.game, async () => {
      const r = await fetch(p.imageUrl, { signal: AbortSignal.timeout(15_000) });
      if (!r.ok) throw new InternalServerErrorException('Imagem indisponível.');
      return { type: r.headers.get('content-type') ?? 'image/webp', body: Buffer.from(await r.arrayBuffer()) };
    });
    res.setHeader('Content-Type', img.type);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(img.body);
  }

  @Post(':mode/guess')
  @HttpCode(200)
  async guess(@Param('mode') modeParam: string, @Body() body: { guess?: unknown; hero?: unknown; x?: unknown; y?: unknown; wrong?: unknown }) {
    const mode = parseMode(modeParam);
    const { day, number } = today();
    const wrongBefore = Number(body?.wrong);
    const max = mode === 'mapa' ? MAP_GUESSES : MAX_GUESSES;
    if (!Number.isInteger(wrongBefore) || wrongBefore < 0 || wrongBefore >= max) throw new BadRequestException('Tentativa inválida.');

    if (mode === 'mapa') {
      const x = Number(body?.x);
      const y = Number(body?.y);
      if (![x, y].every((v) => Number.isFinite(v) && v >= 0 && v <= 1)) throw new BadRequestException('Ponto inválido.');
      const p = await this.mapPuzzle(day);
      const dist = Math.hypot(x - p.x, y - p.y);
      const correct = dist <= MAP_HIT;
      const wrong = correct ? wrongBefore : wrongBefore + 1;
      const finished = correct || wrong >= MAP_GUESSES;
      return {
        number,
        correct,
        distance: Math.round(dist * 1000) / 1000,
        closeness: closeness(dist),
        direction: correct ? null : direction(x, y, p.x, p.y),
        answer: finished ? { x: p.x, y: p.y, label: p.label } : null,
      };
    }

    const guess = typeof body?.guess === 'string' ? body.guess : typeof body?.hero === 'string' ? body.hero : '';
    if (!/^[a-z0-9-]{1,80}$/.test(guess)) throw new BadRequestException('Palpite inválido.');
    if (!(await this.options(mode)).some((o) => o.slug === guess)) throw new BadRequestException('Palpite inválido.');

    const p = await this.choice(mode, day);
    const correct = guess === p.answer;
    const wrong = correct ? wrongBefore : wrongBefore + 1;
    const finished = correct || wrong >= MAX_GUESSES;
    return { number, correct, hints: p.hints(wrong), answer: finished ? p.reveal : null };
  }

  // ───────────────────────── listas de opções ─────────────────────────
  private options(mode: Exclude<Mode, 'mapa'>): Promise<Option[]> {
    return this.cache.get(`daily:options:${mode}`, TTL.game, async () => {
      if (mode === 'habilidade') {
        const heroes = await this.heroes();
        return heroes.map((h) => ({ slug: h['slug'], name: h['name'], name_en: h['name_en'], image: h['small_image'] }));
      }
      if (mode === 'item') {
        // Sem ícone na lista: senão era só comparar a figura
        return (await this.items()).map((i) => ({ slug: i['slug'], name: i['name'], name_en: i['name_en'] }));
      }
      return (await this.mobs()).map((m) => ({ slug: m.slug, name: m.name }));
    });
  }

  // ───────────────────────── desafios do dia ─────────────────────────
  private choice(mode: Exclude<Mode, 'mapa'>, day: string): Promise<ChoicePuzzle> {
    return this.cache.get(`daily:${mode}:${day}`, TTL.game, async () => {
      const seed = seedFor(mode, day);
      if (mode === 'habilidade') return this.abilityPuzzle(seed);
      if (mode === 'item') return this.itemPuzzle(seed);
      return this.mobPuzzle(seed);
    });
  }

  private async abilityPuzzle(seed: Buffer): Promise<ChoicePuzzle> {
    const [{ data: abilities, error }, heroes] = await Promise.all([
      this.supabase.db.from('hero_abilities').select('hero_id, slot, items(name, name_en, image_url)'),
      this.heroes(),
    ]);
    if (error) throw new InternalServerErrorException('Jogo indisponível no momento.');
    const heroById = new Map(heroes.map((h) => [Number(h['id']), h]));
    const pool = ((abilities ?? []) as Row[])
      .filter((a) => a['items']?.['image_url'] && heroById.has(Number(a['hero_id'])))
      // Mesma ordem da primeira versão (para o desafio de hoje não mudar)
      .sort(
        (a, b) =>
          String(heroById.get(Number(a['hero_id']))!['slug']).localeCompare(String(heroById.get(Number(b['hero_id']))!['slug'])) ||
          a['slot'] - b['slot'],
      );
    if (!pool.length) throw new InternalServerErrorException('Jogo indisponível no momento.');
    const a = pool[seed.readUInt32BE(0) % pool.length];
    const h = heroById.get(Number(a['hero_id']))!;
    const ability = a['items']['name'] || a['items']['name_en'];
    return {
      answer: h['slug'],
      answerName: h['name'],
      imageUrl: a['items']['image_url'],
      hints: (w) => [
        ...(w >= 2 ? [`Classe: ${TYPE_LABEL[h['hero_type']] ?? 'desconhecida'}`] : []),
        ...(w >= 3 ? [`É a ${SLOT_LABEL[a['slot']] ?? 'habilidade'} do herói`] : []),
        ...(w >= 4 ? [`Nome da habilidade: ${ability}`] : []),
        ...(w >= 5 ? [`O herói começa com "${String(h['name']).charAt(0)}"`] : []),
      ],
      reveal: { slug: h['slug'], name: h['name'], link: `/herois/${h['slug']}`, detail: `Habilidade: ${ability}` },
    };
  }

  private async itemPuzzle(seed: Buffer): Promise<ChoicePuzzle> {
    const pool = (await this.items()).filter((i) => i['image_url']);
    if (!pool.length) throw new InternalServerErrorException('Jogo indisponível no momento.');
    const i = pool[seed.readUInt32BE(0) % pool.length];
    const name = String(i['name']);
    return {
      answer: i['slug'],
      answerName: name,
      imageUrl: i['image_url'],
      // Ponto do zoom: perto do centro, para o pedaço mostrado ter alguma coisa
      focus: { x: 0.3 + (seed[4] / 255) * 0.4, y: 0.3 + (seed[5] / 255) * 0.4 },
      hints: (w) => [
        ...(w >= 1 ? [`Categoria: ${ITEM_SLOT[i['slot']] ?? 'desconhecida'}`] : []),
        ...(w >= 2 ? [`Tier ${i['tier'] ?? '?'}${i['cost'] ? ` · custa ${Number(i['cost']).toLocaleString('pt-BR')} almas` : ''}`] : []),
        ...(w >= 3 ? [`O nome tem ${name.replace(/\s/g, '').length} letras`] : []),
        ...(w >= 4 ? [`Começa com "${name.charAt(0)}"`] : []),
      ],
      reveal: { slug: i['slug'], name, link: `/itens/${i['slug']}`, detail: ITEM_SLOT[i['slot']] ?? null },
    };
  }

  private async mobPuzzle(seed: Buffer): Promise<ChoicePuzzle> {
    const mobs = await this.mobs();
    if (!mobs.length) throw new InternalServerErrorException('Jogo indisponível no momento.');
    const m = mobs[seed.readUInt32BE(0) % mobs.length];
    return {
      answer: m.slug,
      answerName: m.name,
      imageUrl: m.image,
      hints: (w) => [
        ...(w >= 2 ? [`O nome tem ${m.name.replace(/\s/g, '').length} letras`] : []),
        ...(w >= 3 ? [`Começa com "${m.name.charAt(0)}"`] : []),
        ...(w >= 4 ? [`Em inglês: ${m.nameEn ? m.nameEn.replace(/[A-Za-z]/g, (c, i: number) => (i === 0 ? c : '•')) : '?'}`] : []),
      ],
      reveal: { slug: m.slug, name: m.name, link: '/mapa', detail: m.nameEn ? `Em inglês: ${m.nameEn}` : null },
    };
  }

  private mapPuzzle(day: string): Promise<MapPuzzle> {
    return this.cache.get(`daily:mapa:${day}`, TTL.game, async () => {
      const data = (await this.map.get()) as { image: string | null; markers: Row[] };
      if (!data.image) throw new InternalServerErrorException('Mapa indisponível.');
      // Lugares com nome; longe das bordas para o recorte não sair do mapa
      const pool = data.markers
        .filter((m) => m['kind'] !== 'outro' && m['x'] > 0.08 && m['x'] < 0.92 && m['y'] > 0.08 && m['y'] < 0.92)
        .sort((a, b) => String(a['id']).localeCompare(String(b['id'])));
      if (!pool.length) throw new InternalServerErrorException('Mapa indisponível.');
      const m = pool[seedFor('mapa', day).readUInt32BE(0) % pool.length];
      const label = m['kind'] === 'acampamento' ? (CAMP_LABEL[m['size']] ?? 'Acampamento') : (MARKER_LABEL[m['kind']] ?? 'Ponto do mapa');
      return { x: m['x'], y: m['y'], label, image: data.image };
    });
  }

  // ───────────────────────── dados ─────────────────────────
  private heroes(): Promise<Row[]> {
    return this.cache.get('daily:heroes', TTL.game, async () => {
      const { data, error } = await this.supabase.db.from('hero_cards').select('id, slug, name, name_en, hero_type, small_image').order('name');
      if (error) throw new InternalServerErrorException('Jogo indisponível no momento.');
      return (data ?? []) as Row[];
    });
  }

  private items(): Promise<Row[]> {
    return this.cache.get('daily:items', TTL.game, async () => {
      const { data, error } = await this.supabase.db
        .from('items')
        .select('slug, name, name_en, slot, tier, cost, image_url')
        .eq('type', 'upgrade')
        .eq('shopable', true)
        .eq('is_active', true)
        .order('name');
      if (error) throw new InternalServerErrorException('Jogo indisponível no momento.');
      return ((data ?? []) as Row[]).filter((i) => i['name']);
    });
  }

  /** NPCs com nome e imagem, agrupando variações ("Alfassassino I, II, III" viram um só). */
  private mobs(): Promise<{ slug: string; name: string; nameEn: string | null; image: string }[]> {
    return this.cache.get('daily:mobs', TTL.game, async () => {
      const { data, error } = await this.supabase.db.from('npcs').select('class_name, name, name_en, image_url').order('class_name');
      if (error) throw new InternalServerErrorException('Jogo indisponível no momento.');
      const byName = new Map<string, { slug: string; name: string; nameEn: string | null; image: string }>();
      for (const n of (data ?? []) as Row[]) {
        if (!n['name'] || !n['image_url']) continue;
        const name = baseName(n['name']);
        const slug = slugify(name);
        if (!slug || byName.has(slug)) continue;
        byName.set(slug, { slug, name, nameEn: n['name_en'] ? baseName(n['name_en']) : null, image: n['image_url'] });
      }
      return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    });
  }
}

function parseMode(m: string): Mode {
  if (!MODES.includes(m as Mode)) throw new NotFoundException('Modo de jogo inexistente.');
  return m as Mode;
}

/** Sal opcional (DAILY_SALT) deixa a sequência imprevisível. */
function seedFor(mode: Mode, day: string): Buffer {
  const salt = process.env['DAILY_SALT'] ?? 'ddhub';
  // Habilidade mantém a mesma semente da primeira versão
  return createHash('sha256').update(mode === 'habilidade' ? `${salt}:${day}` : `${salt}:${mode}:${day}`).digest();
}

function baseName(name: string): string {
  return String(name).replace(/\s+(I{1,3}|IV|V|VI|\d+)$/i, '').trim();
}

function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function closeness(d: number): string {
  if (d <= MAP_HIT) return 'Na mosca!';
  if (d <= 0.1) return 'Muito perto';
  if (d <= 0.2) return 'Perto';
  if (d <= 0.35) return 'Longe';
  return 'Muito longe';
}

/** Para onde andar do palpite até a resposta (y cresce para baixo na imagem). */
function direction(fx: number, fy: number, tx: number, ty: number): string {
  const ang = (Math.atan2(-(ty - fy), tx - fx) * 180) / Math.PI;
  const dirs = ['leste', 'nordeste', 'norte', 'noroeste', 'oeste', 'sudoeste', 'sul', 'sudeste'];
  return dirs[Math.round(((ang + 360) % 360) / 45) % 8];
}

/** Data de hoje em Brasília e o número do desafio. */
function today(): { day: string; number: number } {
  const day = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const number = Math.floor((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${LAUNCH}T00:00:00Z`)) / 86_400_000) + 1;
  return { day, number: Math.max(number, 1) };
}

function nextMidnightSaoPaulo(): string {
  const { day } = today();
  return new Date(Date.parse(`${day}T00:00:00-03:00`) + 86_400_000).toISOString();
}
DDHUB_EOF
echo "ok  apps/api/src/daily/daily.controller.ts"

cat > 'apps/api/src/daily/daily.module.ts' <<'DDHUB_EOF'
import { Module } from '@nestjs/common';

import { DailyController } from './daily.controller.js';
import { GameDataModule } from '../game-data/game-data.module.js';

@Module({ imports: [GameDataModule], controllers: [DailyController] })
export class DailyModule {}
DDHUB_EOF
echo "ok  apps/api/src/daily/daily.module.ts"

cat > 'apps/web/src/app/core/services/daily.service.ts' <<'DDHUB_EOF'
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { API_BASE_URL } from '../api.config';

export type DailyMode = 'habilidade' | 'item' | 'mob' | 'mapa';
export type ChoiceMode = Exclude<DailyMode, 'mapa'>;

export const DAILY_MODES: { mode: DailyMode; label: string; question: string }[] = [
  { mode: 'habilidade', label: 'Habilidade', question: 'De qual herói é esta habilidade?' },
  { mode: 'item', label: 'Item', question: 'Que item é este? A imagem vai abrindo a cada erro.' },
  { mode: 'mob', label: 'Mob', question: 'Que criatura ou estrutura é esta? A silhueta ganha cor a cada erro.' },
  { mode: 'mapa', label: 'Mapa', question: 'Onde fica este pedaço do mapa? Clique no mapa inteiro.' },
];

export interface DailyOption {
  slug: string;
  name: string;
  name_en?: string | null;
  image?: string | null;
}

export interface ChoicePuzzle {
  mode: ChoiceMode;
  number: number;
  date: string;
  max_guesses: number;
  /** Caminho na API (/daily/:modo/image?d=…) */
  image: string;
  focus: { x: number; y: number } | null;
  options: DailyOption[];
  next_at: string;
}

export interface MapPuzzle {
  mode: 'mapa';
  number: number;
  date: string;
  max_guesses: number;
  map_image: string;
  focus: { x: number; y: number };
  next_at: string;
}

export interface ChoiceReveal {
  slug: string;
  name: string;
  link: string;
  detail: string | null;
}

export interface ChoiceGuessResult {
  number: number;
  correct: boolean;
  hints: string[];
  answer: ChoiceReveal | null;
}

export interface MapGuessResult {
  number: number;
  correct: boolean;
  distance: number;
  closeness: string;
  direction: string | null;
  answer: { x: number; y: number; label: string } | null;
}

/** Número do desafio de hoje (igual ao do servidor), para a home mostrar sem chamar a API. */
export function dailyNumberToday(): number {
  const day = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return Math.max(Math.floor((Date.parse(`${day}T00:00:00Z`) - Date.parse('2026-11-23T00:00:00Z')) / 86_400_000) + 1, 1);
}

@Injectable({ providedIn: 'root' })
export class DailyService {
  private readonly http = inject(HttpClient);
  readonly api = inject(API_BASE_URL);

  choice(mode: ChoiceMode): Observable<ChoicePuzzle> {
    return this.http.get<ChoicePuzzle>(`${this.api}/daily/${mode}`);
  }

  map(): Observable<MapPuzzle> {
    return this.http.get<MapPuzzle>(`${this.api}/daily/mapa`);
  }

  guessChoice(mode: ChoiceMode, guess: string, wrong: number): Observable<ChoiceGuessResult> {
    return this.http.post<ChoiceGuessResult>(`${this.api}/daily/${mode}/guess`, { guess, wrong });
  }

  guessMap(x: number, y: number, wrong: number): Observable<MapGuessResult> {
    return this.http.post<MapGuessResult>(`${this.api}/daily/mapa/guess`, { x, y, wrong });
  }
}
DDHUB_EOF
echo "ok  apps/web/src/app/core/services/daily.service.ts"

cat > 'apps/web/src/app/features/daily/daily-store.ts' <<'DDHUB_EOF'
import { DailyMode } from '../../core/services/daily.service';

/**
 * Progresso e estatísticas do Diário, salvos só no navegador (localStorage).
 * Chaves: ddhub.daily.<modo>.<número> e ddhub.daily.stats.<modo>.
 * (A 1ª versão guardava a Habilidade em ddhub.daily.<número> — ainda é lida.)
 */
export interface Stats {
  played: number;
  wins: number;
  streak: number;
  best: number;
  last: number;
}

export interface DayResult {
  done: boolean;
  won: boolean;
  /** Tentativas usadas */
  tries: number;
  max: number;
}

export const EMPTY_STATS: Stats = { played: 0, wins: 0, streak: 0, best: 0, last: 0 };

const key = (mode: DailyMode, n: number) => `ddhub.daily.${mode}.${n}`;
const statsKey = (mode: DailyMode) => `ddhub.daily.stats.${mode}`;

function read<T>(k: string): T | null {
  try {
    const raw = localStorage.getItem(k);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(k: string, v: unknown): void {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* sem armazenamento: joga sem salvar */
  }
}

export function loadProgress<T>(mode: DailyMode, n: number): T | null {
  return read<T>(key(mode, n)) ?? (mode === 'habilidade' ? read<T>(`ddhub.daily.${n}`) : null);
}

export function saveProgress(mode: DailyMode, n: number, p: unknown): void {
  write(key(mode, n), p);
}

export function loadStats(mode: DailyMode): Stats {
  const s = read<Stats>(statsKey(mode)) ?? (mode === 'habilidade' ? read<Stats>('ddhub.daily.stats') : null);
  return { ...EMPTY_STATS, ...(s ?? {}) };
}

/** Registra o fim do desafio de hoje (uma vez por dia). */
export function recordResult(mode: DailyMode, n: number, won: boolean): Stats {
  const s = loadStats(mode);
  if (s.last === n) return s;
  const streak = won ? (s.last === n - 1 ? s.streak + 1 : 1) : 0;
  const next: Stats = { played: s.played + 1, wins: s.wins + (won ? 1 : 0), streak, best: Math.max(s.best, streak), last: n };
  write(statsKey(mode), next);
  return next;
}

/** Resumo do dia de um modo (para a tela geral e o compartilhar). */
export function dayResult(mode: DailyMode, n: number, max: number): DayResult {
  const p = loadProgress<{ guesses?: { correct: boolean }[]; answer?: unknown }>(mode, n);
  const guesses = p?.guesses ?? [];
  const won = guesses.some((g) => g.correct);
  return { done: won || !!p?.answer, won, tries: guesses.length, max };
}

export function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
DDHUB_EOF
echo "ok  apps/web/src/app/features/daily/daily-store.ts"

cat > 'apps/web/src/app/features/daily/choice-game.ts' <<'DDHUB_EOF'
import { Component, computed, inject, input, output, signal, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';

import {
  ChoiceMode,
  ChoicePuzzle,
  ChoiceReveal,
  DailyOption,
  DailyService,
} from '../../core/services/daily.service';
import { loadProgress, loadStats, norm, recordResult, saveProgress, Stats } from './daily-store';

interface Guess {
  slug: string;
  name: string;
  correct: boolean;
}

interface Progress {
  guesses: Guess[];
  hints: string[];
  answer: ChoiceReveal | null;
}

/** Zoom do item por número de erros (4× no começo, imagem inteira no fim). */
const ITEM_ZOOM = [4, 3.2, 2.5, 1.9, 1.4, 1.15];
/** Mob: silhueta preta que vai ganhando luz. */
const MOB_LIGHT = [0, 0, 0.12, 0.3, 0.55, 0.8];

/** Desafios de escolher da lista: Habilidade, Item e Mob. */
@Component({
  selector: 'app-choice-game',
  imports: [RouterLink],
  template: `
    @if (error()) {
      <p class="state">O desafio não carregou. Tente de novo em alguns segundos (a API pode estar acordando).</p>
    } @else if (!puzzle()) {
      <p class="state">Carregando o desafio…</p>
    } @else {
      @let p = puzzle()!;
      <div class="stage" [class.done]="finished()">
        <div class="frame" [class]="'frame frame--' + mode()">
          <img
            [src]="imageUrl()"
            alt="Imagem do desafio"
            draggable="false"
            [style.transform]="zoom()"
            [style.transform-origin]="origin()"
            [style.filter]="filter()"
          />
        </div>
        <p class="tries">Tentativa {{ Math.min(guesses().length + 1, p.max_guesses) }} de {{ p.max_guesses }}</p>
      </div>

      @if (hints().length) {
        <ul class="hints">
          @for (h of hints(); track h) {
            <li>💡 {{ h }}</li>
          }
        </ul>
      }

      @if (!finished()) {
        <div class="picker">
          <input
            type="text"
            [value]="query()"
            (input)="query.set($any($event.target).value)"
            (keydown.enter)="pickFirst()"
            [placeholder]="placeholder()"
            [disabled]="sending()"
            autocomplete="off"
            aria-label="Seu palpite"
          />
          @if (query().trim()) {
            <ul class="opts" role="listbox">
              @for (o of filtered(); track o.slug) {
                <li>
                  <button type="button" (click)="guess(o)" [disabled]="sending()">
                    @if (o.image) {
                      <img [src]="o.image" alt="" />
                    }
                    <span>{{ o.name }}</span>
                    @if (o.name_en && o.name_en !== o.name) {
                      <small>{{ o.name_en }}</small>
                    }
                  </button>
                </li>
              } @empty {
                <li class="none">Nada encontrado.</li>
              }
            </ul>
          }
        </div>
      }

      @if (guesses().length) {
        <ol class="guesses">
          @for (g of guesses(); track g.slug) {
            <li [class.ok]="g.correct">{{ g.correct ? '🟩' : '🟥' }} {{ g.name }}</li>
          }
        </ol>
      }

      @if (answer(); as a) {
        <div class="result" [class.win]="won()">
          <strong>{{ won() ? 'Acertou!' : 'Não foi dessa vez.' }}</strong>
          <span>
            Resposta: <a [routerLink]="a.link">{{ a.name }}</a>
            @if (a.detail) {
              · {{ a.detail }}
            }
          </span>
          <span class="stats">
            Jogos {{ stats().played }} · Vitórias {{ winRate() }}% · Sequência {{ stats().streak }} · Melhor {{ stats().best }}
          </span>
        </div>
      }
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 14px; }
    .state { color: var(--muted); padding: 24px 0; }
    .stage { display: flex; flex-direction: column; align-items: center; gap: 8px; }
    .frame {
      width: 160px; height: 160px; border-radius: 14px; overflow: hidden;
      background: var(--bg-deep); border: 1px solid var(--border);
      display: grid; place-items: center;
    }
    .frame img { width: 100%; height: 100%; object-fit: contain; transition: transform .5s ease, filter .5s ease; user-select: none; }
    .frame--habilidade img { padding: 18px; }
    .frame--mob { width: 220px; height: 220px; background: radial-gradient(circle, var(--surface-sub), var(--bg-deep)); }
    .tries { font-size: 13px; color: var(--muted); margin: 0; }
    .hints { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .hints li { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 8px 12px; font-size: 14px; }
    .picker { position: relative; }
    .picker input {
      width: 100%; padding: 12px 14px; border-radius: 10px; border: 1px solid var(--border);
      background: var(--surface); color: var(--text-strong); font: inherit; font-size: 15px;
    }
    .picker input:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
    .opts {
      position: absolute; z-index: 5; left: 0; right: 0; top: calc(100% + 4px); max-height: 260px; overflow: auto;
      list-style: none; margin: 0; padding: 4px; background: var(--surface-head); border: 1px solid var(--border); border-radius: 10px;
    }
    .opts button {
      width: 100%; display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: 0; border-radius: 8px;
      background: none; color: var(--text); font: inherit; text-align: left; cursor: pointer;
    }
    .opts button:hover, .opts li:first-child button { background: var(--surface-sub); }
    .opts img { width: 28px; height: 28px; border-radius: 6px; object-fit: cover; }
    .opts small { color: var(--muted); margin-left: auto; }
    .opts .none { padding: 8px 10px; color: var(--muted); }
    .guesses { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
    .guesses li { background: var(--surface); border: 1px solid var(--border); border-radius: 999px; padding: 4px 12px; font-size: 14px; }
    .guesses li.ok { border-color: var(--win); }
    .result {
      display: flex; flex-direction: column; gap: 4px; padding: 14px 16px; border-radius: 12px;
      background: var(--surface); border: 1px solid var(--live);
    }
    .result.win { border-color: var(--win); }
    .result strong { font-family: var(--font-display); font-size: 18px; color: var(--text-strong); }
    .result .stats { font-size: 13px; color: var(--muted); }
  `,
})
export class ChoiceGame implements OnInit {
  private readonly daily = inject(DailyService);
  protected readonly Math = Math;

  readonly mode = input.required<ChoiceMode>();
  /** Avisa a página quando o desafio termina (para atualizar abas e compartilhar). */
  readonly finishedChange = output<void>();

  protected readonly puzzle = signal<ChoicePuzzle | null>(null);
  protected readonly error = signal(false);
  protected readonly guesses = signal<Guess[]>([]);
  protected readonly hints = signal<string[]>([]);
  protected readonly answer = signal<ChoiceReveal | null>(null);
  protected readonly query = signal('');
  protected readonly sending = signal(false);
  protected readonly stats = signal<Stats>(loadStats('habilidade'));

  protected readonly wrong = computed(() => this.guesses().filter((g) => !g.correct).length);
  protected readonly won = computed(() => this.guesses().some((g) => g.correct));
  protected readonly finished = computed(() => this.won() || !!this.answer());
  protected readonly winRate = computed(() => (this.stats().played ? Math.round((this.stats().wins / this.stats().played) * 100) : 0));

  protected readonly placeholder = computed(() =>
    this.mode() === 'habilidade' ? 'Digite o nome do herói…' : this.mode() === 'item' ? 'Digite o nome do item…' : 'Digite o nome do mob…',
  );

  protected readonly imageUrl = computed(() => {
    const p = this.puzzle();
    return p ? `${this.daily.api}${p.image}` : '';
  });

  protected readonly zoom = computed(() => {
    if (this.mode() !== 'item' || this.finished()) return 'scale(1)';
    return `scale(${ITEM_ZOOM[Math.min(this.wrong(), ITEM_ZOOM.length - 1)]})`;
  });

  protected readonly origin = computed(() => {
    const f = this.puzzle()?.focus;
    return f ? `${f.x * 100}% ${f.y * 100}%` : '50% 50%';
  });

  protected readonly filter = computed(() => {
    if (this.mode() !== 'mob' || this.finished()) return 'none';
    return `brightness(${MOB_LIGHT[Math.min(this.wrong(), MOB_LIGHT.length - 1)]})`;
  });

  protected readonly filtered = computed<DailyOption[]>(() => {
    const q = norm(this.query());
    const used = new Set(this.guesses().map((g) => g.slug));
    if (!q) return [];
    return (this.puzzle()?.options ?? [])
      .filter((o) => !used.has(o.slug) && (norm(o.name).includes(q) || (o.name_en ? norm(o.name_en).includes(q) : false)))
      .sort((a, b) => Number(!norm(a.name).startsWith(q)) - Number(!norm(b.name).startsWith(q)))
      .slice(0, 8);
  });

  ngOnInit(): void {
    this.stats.set(loadStats(this.mode()));
    this.daily.choice(this.mode()).subscribe({
      next: (p) => {
        this.puzzle.set(p);
        const saved = loadProgress<Progress>(this.mode(), p.number);
        if (saved) {
          this.guesses.set(saved.guesses ?? []);
          this.hints.set(saved.hints ?? []);
          this.answer.set(saved.answer ?? null);
        }
      },
      error: () => this.error.set(true),
    });
  }

  protected pickFirst(): void {
    const first = this.filtered()[0];
    if (first) this.guess(first);
  }

  protected guess(o: DailyOption): void {
    const p = this.puzzle();
    if (!p || this.sending() || this.finished()) return;
    this.sending.set(true);
    this.daily.guessChoice(this.mode(), o.slug, this.wrong()).subscribe({
      next: (r) => {
        this.sending.set(false);
        this.query.set('');
        this.guesses.update((g) => [...g, { slug: o.slug, name: o.name, correct: r.correct }]);
        this.hints.set(r.hints);
        this.answer.set(r.answer);
        saveProgress(this.mode(), p.number, { guesses: this.guesses(), hints: this.hints(), answer: this.answer() } satisfies Progress);
        if (r.answer) {
          this.stats.set(recordResult(this.mode(), p.number, r.correct));
          this.finishedChange.emit();
        }
      },
      error: () => this.sending.set(false),
    });
  }
}
DDHUB_EOF
echo "ok  apps/web/src/app/features/daily/choice-game.ts"

cat > 'apps/web/src/app/features/daily/map-game.ts' <<'DDHUB_EOF'
import { Component, computed, inject, output, signal, OnInit } from '@angular/core';

import { DailyService, MapGuessResult, MapPuzzle } from '../../core/services/daily.service';
import { loadProgress, loadStats, recordResult, saveProgress, Stats } from './daily-store';

interface Guess {
  x: number;
  y: number;
  correct: boolean;
  closeness: string;
  direction: string | null;
}

interface Progress {
  guesses: Guess[];
  answer: MapGuessResult['answer'];
}

/** Zoom do recorte por número de erros (abre a cada erro). */
const ZOOM = [6, 4.5, 3.3, 2.4, 1.8];

/** "Onde fica?": mostra um pedaço do mapa e a pessoa clica no lugar certo do mapa inteiro. */
@Component({
  selector: 'app-map-game',
  template: `
    @if (error()) {
      <p class="state">O desafio não carregou. Tente de novo em alguns segundos (a API pode estar acordando).</p>
    } @else if (!puzzle()) {
      <p class="state">Carregando o mapa…</p>
    } @else {
      @let p = puzzle()!;
      <div class="layout">
        <div class="side">
          <div class="crop" [style.background-image]="'url(' + p.map_image + ')'" [style.background-size]="cropSize()" [style.background-position]="cropPos()">
            <span class="cross" aria-hidden="true"></span>
          </div>
          <p class="tries">Tentativa {{ Math.min(guesses().length + 1, p.max_guesses) }} de {{ p.max_guesses }}</p>

          @if (guesses().length) {
            <ol class="guesses">
              @for (g of guesses(); track $index) {
                <li [class.ok]="g.correct">
                  {{ g.correct ? '🟩' : '🟥' }} {{ g.closeness }}
                  @if (g.direction) {
                    · vá para o {{ g.direction }}
                  }
                </li>
              }
            </ol>
          }

          @if (answer(); as a) {
            <div class="result" [class.win]="won()">
              <strong>{{ won() ? 'Acertou!' : 'Não foi dessa vez.' }}</strong>
              <span>O lugar era: {{ a.label }}</span>
              <span class="stats">Jogos {{ stats().played }} · Sequência {{ stats().streak }} · Melhor {{ stats().best }}</span>
            </div>
          } @else {
            <button class="confirm" type="button" [disabled]="!pending() || sending()" (click)="send()">
              {{ pending() ? 'Confirmar palpite' : 'Clique no mapa para marcar' }}
            </button>
          }
        </div>

        <div class="full" (click)="mark($event)" [class.locked]="finished()">
          <img [src]="p.map_image" alt="Mapa do Deadlock" draggable="false" />
          @for (g of guesses(); track $index) {
            <span class="pin" [class.ok]="g.correct" [style.left.%]="g.x * 100" [style.top.%]="g.y * 100">{{ $index + 1 }}</span>
          }
          @if (pending(); as pt) {
            <span class="pin pin--pending" [style.left.%]="pt.x * 100" [style.top.%]="pt.y * 100"></span>
          }
          @if (answer(); as a) {
            <span class="pin pin--answer" [style.left.%]="a.x * 100" [style.top.%]="a.y * 100">★</span>
          }
        </div>
      </div>
    }
  `,
  styles: `
    :host { display: block; }
    .state { color: var(--muted); padding: 24px 0; }
    .layout { display: grid; grid-template-columns: 240px 1fr; gap: 20px; align-items: start; }
    @media (max-width: 720px) { .layout { grid-template-columns: 1fr; } }
    .side { display: flex; flex-direction: column; gap: 10px; }
    .crop {
      position: relative; width: 100%; aspect-ratio: 1; border-radius: 14px; border: 1px solid var(--border);
      background-color: var(--bg-deep); background-repeat: no-repeat; transition: background-size .5s ease, background-position .5s ease;
    }
    .cross { position: absolute; left: 50%; top: 50%; width: 14px; height: 14px; margin: -7px; border: 2px solid var(--accent); border-radius: 50%; }
    .tries { font-size: 13px; color: var(--muted); margin: 0; }
    .guesses { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; font-size: 14px; }
    .guesses li { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 6px 10px; }
    .guesses li.ok { border-color: var(--win); }
    .confirm {
      padding: 11px 14px; border-radius: 10px; border: 0; background: var(--accent); color: var(--bg-deep);
      font: inherit; font-weight: 700; cursor: pointer;
    }
    .confirm:disabled { opacity: .5; cursor: default; }
    .result { display: flex; flex-direction: column; gap: 4px; padding: 12px 14px; border-radius: 12px; background: var(--surface); border: 1px solid var(--live); }
    .result.win { border-color: var(--win); }
    .result strong { font-family: var(--font-display); font-size: 18px; color: var(--text-strong); }
    .result .stats { font-size: 13px; color: var(--muted); }
    .full { position: relative; border-radius: 14px; overflow: hidden; border: 1px solid var(--border); cursor: crosshair; background: var(--bg-deep); }
    .full.locked { cursor: default; }
    .full img { display: block; width: 100%; height: auto; user-select: none; }
    .pin {
      position: absolute; transform: translate(-50%, -50%); width: 20px; height: 20px; border-radius: 50%;
      display: grid; place-items: center; font-size: 11px; font-weight: 700;
      background: var(--live); color: #fff; border: 2px solid #fff; pointer-events: none;
    }
    .pin.ok { background: var(--win); }
    .pin--pending { background: var(--accent); }
    .pin--answer { width: 26px; height: 26px; background: var(--win); font-size: 14px; }
  `,
})
export class MapGame implements OnInit {
  private readonly daily = inject(DailyService);
  protected readonly Math = Math;

  readonly finishedChange = output<void>();

  protected readonly puzzle = signal<MapPuzzle | null>(null);
  protected readonly error = signal(false);
  protected readonly guesses = signal<Guess[]>([]);
  protected readonly answer = signal<MapGuessResult['answer']>(null);
  protected readonly pending = signal<{ x: number; y: number } | null>(null);
  protected readonly sending = signal(false);
  protected readonly stats = signal<Stats>(loadStats('mapa'));

  protected readonly wrong = computed(() => this.guesses().filter((g) => !g.correct).length);
  protected readonly won = computed(() => this.guesses().some((g) => g.correct));
  protected readonly finished = computed(() => this.won() || !!this.answer());

  private readonly zoomLevel = computed(() => (this.finished() ? 1.6 : ZOOM[Math.min(this.wrong(), ZOOM.length - 1)]));

  protected readonly cropSize = computed(() => `${this.zoomLevel() * 100}%`);

  /** Posição do fundo para o ponto do desafio ficar no centro do recorte. */
  protected readonly cropPos = computed(() => {
    const f = this.puzzle()?.focus ?? { x: 0.5, y: 0.5 };
    const z = this.zoomLevel();
    const pos = (c: number) => Math.min(Math.max((0.5 - c * z) / (1 - z), 0), 1) * 100;
    return `${pos(f.x)}% ${pos(f.y)}%`;
  });

  ngOnInit(): void {
    this.daily.map().subscribe({
      next: (p) => {
        this.puzzle.set(p);
        const saved = loadProgress<Progress>('mapa', p.number);
        if (saved) {
          this.guesses.set(saved.guesses ?? []);
          this.answer.set(saved.answer ?? null);
        }
      },
      error: () => this.error.set(true),
    });
  }

  protected mark(ev: MouseEvent): void {
    if (this.finished() || this.sending()) return;
    const box = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const x = (ev.clientX - box.left) / box.width;
    const y = (ev.clientY - box.top) / box.height;
    if (x >= 0 && x <= 1 && y >= 0 && y <= 1) this.pending.set({ x, y });
  }

  protected send(): void {
    const p = this.puzzle();
    const pt = this.pending();
    if (!p || !pt || this.sending() || this.finished()) return;
    this.sending.set(true);
    this.daily.guessMap(pt.x, pt.y, this.wrong()).subscribe({
      next: (r) => {
        this.sending.set(false);
        this.pending.set(null);
        this.guesses.update((g) => [...g, { x: pt.x, y: pt.y, correct: r.correct, closeness: r.closeness, direction: r.direction }]);
        this.answer.set(r.answer);
        saveProgress('mapa', p.number, { guesses: this.guesses(), answer: this.answer() } satisfies Progress);
        if (r.answer) {
          this.stats.set(recordResult('mapa', p.number, r.correct));
          this.finishedChange.emit();
        }
      },
      error: () => this.sending.set(false),
    });
  }
}
DDHUB_EOF
echo "ok  apps/web/src/app/features/daily/map-game.ts"

cat > 'apps/web/src/app/features/daily/daily-page.ts' <<'DDHUB_EOF'
import { Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { DAILY_MODES, DailyMode, dailyNumberToday } from '../../core/services/daily.service';
import { ChoiceGame } from './choice-game';
import { MapGame } from './map-game';
import { dayResult, DayResult } from './daily-store';

const MAX: Record<DailyMode, number> = { habilidade: 6, item: 6, mob: 6, mapa: 5 };

/** DDhub Diário: 4 desafios por dia (Habilidade, Item, Mob, Mapa). Aba escolhida em ?modo= */
@Component({
  selector: 'app-daily-page',
  imports: [RouterLink, ChoiceGame, MapGame],
  templateUrl: './daily-page.html',
  styleUrl: './daily-page.scss',
})
export class DailyPage {
  /** Vem da URL (?modo=item) */
  readonly modo = input<string | undefined>();

  protected readonly modes = DAILY_MODES;
  protected readonly number = dailyNumberToday();
  protected readonly current = computed<DailyMode>(() => {
    const m = this.modo();
    return DAILY_MODES.some((x) => x.mode === m) ? (m as DailyMode) : 'habilidade';
  });
  protected readonly question = computed(() => DAILY_MODES.find((m) => m.mode === this.current())!.question);

  /** Recalculado quando um desafio termina */
  private readonly tick = signal(0);
  protected readonly results = computed<Record<DailyMode, DayResult>>(() => {
    this.tick();
    return Object.fromEntries(DAILY_MODES.map(({ mode }) => [mode, dayResult(mode, this.number, MAX[mode])])) as Record<DailyMode, DayResult>;
  });
  protected readonly doneCount = computed(() => Object.values(this.results()).filter((r) => r.done).length);

  protected readonly countdown = signal(this.timeLeft());
  protected readonly copied = signal(false);

  constructor() {
    const id = setInterval(() => this.countdown.set(this.timeLeft()), 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(id));
  }

  protected refresh(): void {
    this.tick.update((n) => n + 1);
  }

  protected badge(mode: DailyMode): string {
    const r = this.results()[mode];
    return !r.done ? '' : r.won ? '🟩' : '🟥';
  }

  protected shareText(): string {
    const lines = DAILY_MODES.map(({ mode, label }) => {
      const r = this.results()[mode];
      if (!r.done) return `⬜ ${label} —`;
      return `${r.won ? '🟩' : '🟥'} ${label} ${r.won ? r.tries : 'X'}/${r.max}`;
    });
    return [`DDhub Diário #${this.number}`, ...lines, 'ddhub-br.vercel.app/diario'].join('\n');
  }

  protected async share(): Promise<void> {
    const text = this.shareText();
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ text });
        return;
      }
      await navigator.clipboard.writeText(text);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
      /* cancelado */
    }
  }

  /** Tempo até a meia-noite de Brasília (UTC-3). */
  private timeLeft(): string {
    const now = Date.now();
    const brt = now - 3 * 3_600_000;
    const next = (Math.floor(brt / 86_400_000) + 1) * 86_400_000 + 3 * 3_600_000;
    const s = Math.max(0, Math.floor((next - now) / 1000));
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  }
}
DDHUB_EOF
echo "ok  apps/web/src/app/features/daily/daily-page.ts"

cat > 'apps/web/src/app/features/daily/daily-page.html' <<'DDHUB_EOF'
<section class="daily">
  <header class="head">
    <div>
      <p class="kicker">Desafio diário #{{ number }}</p>
      <h1>DDhub Diário</h1>
      <p class="sub">4 desafios por dia, iguais para todo mundo. Novos em <strong>{{ countdown() }}</strong>.</p>
    </div>
    <button class="share" type="button" (click)="share()" [disabled]="!doneCount()">
      {{ copied() ? 'Copiado!' : 'Compartilhar ' + doneCount() + '/4' }}
    </button>
  </header>

  <nav class="tabs" aria-label="Modos do desafio">
    @for (m of modes; track m.mode) {
      <a
        [routerLink]="[]"
        [queryParams]="{ modo: m.mode === 'habilidade' ? null : m.mode }"
        [class.active]="current() === m.mode"
        [attr.aria-current]="current() === m.mode ? 'page' : null"
      >
        {{ m.label }} <span class="badge">{{ badge(m.mode) }}</span>
      </a>
    }
  </nav>

  <p class="question">{{ question() }}</p>

  @switch (current()) {
    @case ('habilidade') {
      <app-choice-game mode="habilidade" (finishedChange)="refresh()" />
    }
    @case ('item') {
      <app-choice-game mode="item" (finishedChange)="refresh()" />
    }
    @case ('mob') {
      <app-choice-game mode="mob" (finishedChange)="refresh()" />
    }
    @case ('mapa') {
      <app-map-game (finishedChange)="refresh()" />
    }
  }

  <p class="note">
    Imagens do jogo via Deadlock API · Deadlock é marca da Valve. Seu progresso fica salvo só neste navegador.
  </p>
</section>
DDHUB_EOF
echo "ok  apps/web/src/app/features/daily/daily-page.html"

cat > 'apps/web/src/app/features/daily/daily-page.scss' <<'DDHUB_EOF'
.daily {
  max-width: 900px;
  margin: 0 auto;
  padding: 28px 16px 48px;
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

.sub {
  margin: 0;
  color: var(--muted);
  font-size: 14px;
}

.share {
  padding: 10px 16px;
  border-radius: 10px;
  border: 1px solid var(--accent);
  background: var(--accent-soft);
  color: var(--text-strong);
  font: inherit;
  font-weight: 600;
  cursor: pointer;

  &:disabled {
    opacity: 0.45;
    cursor: default;
  }
}

.tabs {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  border-bottom: 1px solid var(--border);

  a {
    padding: 10px 16px;
    color: var(--muted);
    text-decoration: none;
    font-weight: 600;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    white-space: nowrap;

    &:hover {
      color: var(--text);
    }

    &.active {
      color: var(--text-strong);
      border-bottom-color: var(--accent);
    }
  }

  .badge {
    font-size: 12px;
  }
}

.question {
  margin: 4px 0 0;
  font-size: 16px;
  color: var(--text-strong);
}

.note {
  margin: 12px 0 0;
  font-size: 12px;
  color: var(--faint);
}
DDHUB_EOF
echo "ok  apps/web/src/app/features/daily/daily-page.scss"

rm -f apps/web/src/app/features/daily/daily-game.ts apps/web/src/app/features/daily/daily-game.html apps/web/src/app/features/daily/daily-game.scss
echo "removido  daily-game.* (substituído pela página do Diário)"

node - <<'JS'
const fs = require('fs');
function edit(p, find, repl, check) {
  let s = fs.readFileSync(p, 'utf8');
  if (s.includes(check)) return console.log('já estava  ' + p);
  if (!s.includes(find)) { console.error('NÃO ACHEI o trecho em ' + p); process.exitCode = 1; return; }
  fs.writeFileSync(p, s.replace(find, repl));
  console.log('editado  ' + p);
}
edit('apps/api/src/game-data/game-data.module.ts',
  "  providers: [DeadlockApiClient, GameSyncService],\n  exports: [GameSyncService],",
  "  // MapController também como provider: o jogo diário (modo Mapa) usa os mesmos dados\n  providers: [DeadlockApiClient, GameSyncService, MapController],\n  exports: [GameSyncService, MapController],",
  'exports: [GameSyncService, MapController]');
edit('apps/web/src/app/app.routes.ts',
  "  {\n    path: 'adivinhe',\n    title: 'Adivinhe o herói · DDhub',\n    loadComponent: () => import('./features/daily/daily-game').then((m) => m.DailyGame),\n  },",
  "  {\n    path: 'diario',\n    title: 'DDhub Diário · DDhub',\n    loadComponent: () => import('./features/daily/daily-page').then((m) => m.DailyPage),\n  },\n  // Endereço da 1ª versão do jogo\n  { path: 'adivinhe', redirectTo: 'diario' },",
  "path: 'diario'");
edit('apps/web/src/app/features/home/home.ts',
  "text: 'Adivinhe o herói de hoje pela habilidade. Você tem 6 chances.', link: '/adivinhe'",
  "text: '4 desafios novos: habilidade, item, mob e mapa. Quantos você acerta?', link: '/diario'",
  "link: '/diario'");
edit('apps/web/src/app/layout/header/header.ts',
  "{ label: 'Adivinhe o herói', path: '/adivinhe', hint: 'Desafio diário' }",
  "{ label: 'DDhub Diário', path: '/diario', hint: 'Habilidade, item, mob e mapa' }",
  "path: '/diario'");
JS

echo
echo "Conferência (esperado: 2 1 1 1 1 0):"
grep -c "MapController]" apps/api/src/game-data/game-data.module.ts
grep -c "path: 'diario'" apps/web/src/app/app.routes.ts
grep -c "link: '/diario'" apps/web/src/app/features/home/home.ts
grep -c "path: '/diario'" apps/web/src/app/layout/header/header.ts
grep -c "@Get(':mode/image')" apps/api/src/daily/daily.controller.ts
ls apps/web/src/app/features/daily/daily-game.* 2>/dev/null | wc -l
