import { BadRequestException, Controller, Get, InternalServerErrorException, Query } from '@nestjs/common';

import { SupabaseService } from '../supabase/supabase.service.js';
import { MemoryCache, TTL } from '../cache/memory-cache.service.js';

export type SearchType = 'heroi' | 'item' | 'time' | 'jogador' | 'criador' | 'torneio' | 'noticia' | 'aprender';

export interface SearchResult {
  type: SearchType;
  label: string;
  /** Linha de apoio: sigla, categoria, "Herói", nome em inglês… */
  sub: string | null;
  url: string;
  image: string | null;
}

interface Entry extends SearchResult {
  /** Textos onde procurar (já normalizados) */
  terms: string[];
  /** Desempate: heróis e times aparecem antes de notícia velha */
  weight: number;
}

const MAX_TOTAL = 12;
const MAX_PER_TYPE = 4;

type Row = Record<string, any>;

/** "Lady Geist" / "lády-geist" → "lady geist" */
const norm = (s: string | null | undefined) =>
  (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * GET /search?q=texto — busca em tudo do DDhub de uma vez.
 * O índice (alguns milhares de linhas no máximo) fica em memória por 10 min;
 * cada busca é só um filtro em memória, sem ir ao banco.
 */
@Controller('search')
export class SearchController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly cache: MemoryCache,
  ) {}

  @Get()
  async search(@Query('q') q?: string): Promise<SearchResult[]> {
    const query = norm(q);
    if (query.length < 2) return [];
    if (query.length > 60) throw new BadRequestException('Busca muito longa.');
    const words = query.split(' ');

    const index = await this.cache.get('search-index', TTL.content, () => this.buildIndex());
    const scored: { e: Entry; score: number }[] = [];
    for (const e of index) {
      let best = 0;
      for (const t of e.terms) {
        // Todas as palavras precisam aparecer
        if (!words.every((w) => t.includes(w))) continue;
        const s = t === query ? 100 : t.startsWith(query) ? 80 : t.split(' ').some((w) => w.startsWith(words[0])) ? 60 : 40;
        best = Math.max(best, s);
      }
      if (best) scored.push({ e, score: best + e.weight });
    }
    scored.sort((a, b) => b.score - a.score || a.e.label.localeCompare(b.e.label, 'pt-BR'));

    const perType = new Map<SearchType, number>();
    const out: SearchResult[] = [];
    for (const { e } of scored) {
      const n = perType.get(e.type) ?? 0;
      if (n >= MAX_PER_TYPE) continue;
      perType.set(e.type, n + 1);
      out.push({ type: e.type, label: e.label, sub: e.sub, url: e.url, image: e.image });
      if (out.length >= MAX_TOTAL) break;
    }
    return out;
  }

  private async buildIndex(): Promise<Entry[]> {
    const db = this.supabase.db;
    const now = new Date().toISOString();
    const [heroes, items, teams, players, creators, tournaments, articles, patches, chapters] = await Promise.all([
      db.from('hero_cards').select('slug, name, name_en, small_image'),
      db.from('items').select('slug, name, name_en, slot, image_url').eq('type', 'upgrade').eq('shopable', true).eq('is_active', true),
      db.from('teams').select('slug, name, tag, logo_url, is_active'),
      db.from('players').select('slug, nickname, photo_url'),
      db.from('creators').select('slug, name, avatar_url').not('published_at', 'is', null).lte('published_at', now),
      db.from('tournaments').select('slug, name, starts_at'),
      db.from('articles').select('slug, title, category').not('published_at', 'is', null).lte('published_at', now),
      db.from('patch_notes').select('gid, title, title_pt, is_patch, published_at').order('published_at', { ascending: false }).limit(60),
      db.from('learn_chapters').select('slug, title').not('published_at', 'is', null).lte('published_at', now),
    ]);
    const failed = [heroes, items, teams, players, creators, tournaments, articles, patches, chapters].find((r) => r.error);
    if (failed) throw new InternalServerErrorException('Busca indisponível no momento.');

    const rows = (r: { data: unknown }) => (r.data ?? []) as Row[];
    const slot: Record<string, string> = { weapon: 'Item de arma', vitality: 'Item de vitalidade', spirit: 'Item espiritual' };
    const index: Entry[] = [];

    for (const h of rows(heroes)) {
      index.push({ type: 'heroi', label: h['name'], sub: h['name_en'] && h['name_en'] !== h['name'] ? `Herói · ${h['name_en']}` : 'Herói',
        url: `/herois/${h['slug']}`, image: h['small_image'], terms: [norm(h['name']), norm(h['name_en'])], weight: 15 });
    }
    for (const i of rows(items)) {
      index.push({ type: 'item', label: i['name'], sub: slot[i['slot']] ?? 'Item', url: `/itens/${i['slug']}`, image: i['image_url'],
        terms: [norm(i['name']), norm(i['name_en'])], weight: 10 });
    }
    for (const t of rows(teams)) {
      index.push({ type: 'time', label: t['name'], sub: [t['tag'], t['is_active'] ? 'Time' : 'Time inativo'].filter(Boolean).join(' · '),
        url: `/times/${t['slug']}`, image: t['logo_url'], terms: [norm(t['name']), norm(t['tag'])], weight: 14 });
    }
    for (const p of rows(players)) {
      index.push({ type: 'jogador', label: p['nickname'], sub: 'Jogador', url: `/jogadores/${p['slug']}`, image: p['photo_url'],
        terms: [norm(p['nickname']), norm(p['slug'])], weight: 12 });
    }
    for (const c of rows(creators)) {
      index.push({ type: 'criador', label: c['name'], sub: 'Criador de conteúdo', url: '/criadores', image: c['avatar_url'],
        terms: [norm(c['name']), norm(c['slug'])], weight: 11 });
    }
    for (const t of rows(tournaments)) {
      index.push({ type: 'torneio', label: t['name'], sub: t['starts_at'] ? `Torneio · ${String(t['starts_at']).slice(0, 4)}` : 'Torneio',
        url: `/torneios/${t['slug']}`, image: null, terms: [norm(t['name'])], weight: 9 });
    }
    for (const a of rows(articles)) {
      index.push({ type: 'noticia', label: a['title'], sub: 'Notícia', url: `/noticias/${a['slug']}`, image: null, terms: [norm(a['title'])], weight: 6 });
    }
    for (const p of rows(patches)) {
      const title = p['title_pt'] || p['title'];
      index.push({ type: 'noticia', label: title, sub: `${p['is_patch'] ? 'Patch' : 'Anúncio'} · ${String(p['published_at']).slice(0, 10).split('-').reverse().join('/')}`,
        url: `/noticias/steam-${p['gid']}`, image: null, terms: [norm(title), norm(p['title'])], weight: 5 });
    }
    for (const c of rows(chapters)) {
      index.push({ type: 'aprender', label: c['title'], sub: 'Aprender', url: `/aprender/${c['slug']}`, image: null, terms: [norm(c['title'])], weight: 8 });
    }
    // Termos vazios não contam
    for (const e of index) e.terms = e.terms.filter(Boolean);
    return index;
  }
}
