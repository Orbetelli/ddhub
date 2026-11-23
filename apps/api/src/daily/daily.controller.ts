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
    const p = await this.choice('habilidade', today().day);
    return { ...data, icon: p.imageUrl, heroes: await this.options('habilidade') };
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
