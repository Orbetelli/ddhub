import { BadRequestException, Body, Controller, Get, HttpCode, InternalServerErrorException, Post } from '@nestjs/common';
import { createHash } from 'node:crypto';

import { SupabaseService } from '../supabase/supabase.service.js';
import { MemoryCache, TTL } from '../cache/memory-cache.service.js';

/** Dia 1 do jogo (os números "#12" contam a partir daqui). */
const LAUNCH = '2026-11-23';
export const MAX_GUESSES = 6;

const TYPE_LABEL: Record<string, string> = { assassin: 'Assassino', brawler: 'Lutador', marksman: 'Atirador', mystic: 'Místico' };
const SLOT_LABEL: Record<number, string> = { 1: '1ª habilidade', 2: '2ª habilidade', 3: '3ª habilidade', 4: 'Ultimate' };

type Row = Record<string, any>;

interface Puzzle {
  heroSlug: string;
  heroName: string;
  heroType: string | null;
  slot: number;
  abilityName: string;
  icon: string;
}

interface HeroOption {
  slug: string;
  name: string;
  name_en: string | null;
  image: string | null;
}

/** Dica liberada depois de N erros. */
function hintsFor(p: Puzzle, wrong: number): string[] {
  const hints: string[] = [];
  if (wrong >= 2) hints.push(`Classe: ${(p.heroType && TYPE_LABEL[p.heroType]) || 'desconhecida'}`);
  if (wrong >= 3) hints.push(`É a ${SLOT_LABEL[p.slot] ?? 'habilidade'} do herói`);
  if (wrong >= 4) hints.push(`Nome da habilidade: ${p.abilityName}`);
  if (wrong >= 5) hints.push(`O herói começa com "${p.heroName.charAt(0)}"`);
  return hints;
}

/**
 * "Adivinhe o herói" diário: todo dia o ícone de uma habilidade; a pessoa tem 6 chances.
 * A resposta fica só no servidor (o site não sabe qual é antes de acertar ou perder).
 *   GET  /daily        → número do dia, ícone e lista de heróis
 *   POST /daily/guess  → { hero, wrong } → acertou? dicas novas; resposta no fim
 */
@Controller('daily')
export class DailyController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly cache: MemoryCache,
  ) {}

  @Get()
  async today() {
    const { day, number } = today();
    const [p, heroes] = await Promise.all([this.puzzle(day), this.heroes()]);
    return {
      number,
      date: day,
      max_guesses: MAX_GUESSES,
      icon: p.icon,
      /** Para quem recarrega a página no meio do jogo: as dicas vêm de novo pelo /guess */
      heroes,
      next_at: nextMidnightSaoPaulo(),
    };
  }

  @Post('guess')
  @HttpCode(200)
  async guess(@Body() body: { hero?: unknown; wrong?: unknown }) {
    const hero = typeof body?.hero === 'string' ? body.hero : '';
    const wrongBefore = Number(body?.wrong);
    if (!/^[a-z0-9-]{1,60}$/.test(hero)) throw new BadRequestException('Herói inválido.');
    if (!Number.isInteger(wrongBefore) || wrongBefore < 0 || wrongBefore >= MAX_GUESSES) throw new BadRequestException('Tentativa inválida.');

    const heroes = await this.heroes();
    if (!heroes.some((h) => h.slug === hero)) throw new BadRequestException('Herói inválido.');

    const { day, number } = today();
    const p = await this.puzzle(day);
    const correct = hero === p.heroSlug;
    const wrong = correct ? wrongBefore : wrongBefore + 1;
    const finished = correct || wrong >= MAX_GUESSES;
    return {
      number,
      correct,
      hints: hintsFor(p, wrong),
      // Resposta só aparece quando o jogo acaba
      answer: finished ? { hero: p.heroSlug, name: p.heroName, ability: p.abilityName, slot: p.slot } : null,
    };
  }

  /** Lista de heróis jogáveis (para o campo de palpite). */
  private heroes(): Promise<HeroOption[]> {
    return this.cache.get('daily:heroes', TTL.game, async () => {
      const { data, error } = await this.supabase.db.from('hero_cards').select('slug, name, name_en, small_image').order('name');
      if (error) throw new InternalServerErrorException('Jogo indisponível no momento.');
      return ((data ?? []) as Row[]).map((h) => ({ slug: h['slug'], name: h['name'], name_en: h['name_en'], image: h['small_image'] }));
    });
  }

  /** O desafio do dia: escolhido por um hash da data, igual para todo mundo. */
  private puzzle(day: string): Promise<Puzzle> {
    return this.cache.get(`daily:${day}`, TTL.game, async () => {
      const [{ data: abilities, error }, { data: cards, error: cErr }] = await Promise.all([
        this.supabase.db.from('hero_abilities').select('hero_id, slot, heroes(slug), items(name, name_en, image_url)'),
        this.supabase.db.from('hero_cards').select('id, slug, name, hero_type'),
      ]);
      if (error || cErr) throw new InternalServerErrorException('Jogo indisponível no momento.');
      const cardById = new Map(((cards ?? []) as Row[]).map((c) => [Number(c['id']), c]));

      const pool: Puzzle[] = ((abilities ?? []) as Row[])
        .filter((a) => a['items']?.['image_url'] && cardById.has(Number(a['hero_id'])))
        .map((a) => {
          const c = cardById.get(Number(a['hero_id']))!;
          return {
            heroSlug: c['slug'],
            heroName: c['name'],
            heroType: c['hero_type'],
            slot: a['slot'],
            abilityName: a['items']['name'] || a['items']['name_en'],
            icon: a['items']['image_url'],
          };
        })
        .sort((x, y) => x.heroSlug.localeCompare(y.heroSlug) || x.slot - y.slot);
      if (!pool.length) throw new InternalServerErrorException('Jogo indisponível no momento.');

      // Sal opcional (DAILY_SALT no .env) deixa a sequência imprevisível
      const seed = createHash('sha256').update(`${process.env['DAILY_SALT'] ?? 'ddhub'}:${day}`).digest();
      return pool[seed.readUInt32BE(0) % pool.length];
    });
  }
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
