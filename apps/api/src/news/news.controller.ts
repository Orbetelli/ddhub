import { BadRequestException, Controller, Get, InternalServerErrorException, NotFoundException, Param, Query } from '@nestjs/common';

import { SupabaseService } from '../supabase/supabase.service.js';
import { MemoryCache, TTL } from '../cache/memory-cache.service.js';
import { excerptFrom, steamToMarkdown } from './steam-markup.js';

export type NewsCategory = 'patch' | 'guia' | 'cenario' | 'comunidade';

/** Item da lista de notícias (matéria do DDhub ou anúncio oficial). */
export interface NewsItem {
  slug: string;
  kind: 'article' | 'official';
  category: NewsCategory;
  title: string;
  excerpt: string | null;
  cover_url: string | null;
  published_at: string;
}

export interface NewsDetail extends NewsItem {
  body_md: string;
  /** Link do anúncio original na Steam (só para os oficiais). */
  source_url: string | null;
  /** Anúncio oficial traduzido automaticamente? Se sim, o original vem junto. */
  translated: boolean;
  original_title: string | null;
  original_md: string | null;
}

const SLUG = /^[a-z0-9-]{1,90}$/;
const CATEGORIES: NewsCategory[] = ['patch', 'guia', 'cenario', 'comunidade'];
/** Slugs dos anúncios oficiais: "steam-<gid>" */
const OFFICIAL = /^steam-(\d{1,30})$/;

type Row = Record<string, any>;

/**
 * Notícias: matérias escritas pela equipe (articles, via content:sync)
 * + anúncios oficiais da Valve importados da Steam (patch_notes).
 */
@Controller()
export class NewsController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly cache: MemoryCache,
  ) {}

  @Get('news')
  async list(@Query('category') category?: string, @Query('limit') limit?: string): Promise<NewsItem[]> {
    if (category && !CATEGORIES.includes(category as NewsCategory)) throw new BadRequestException('Categoria inválida.');
    const max = Math.min(Math.max(Number(limit) || 40, 1), 100);
    const all = await this.cache.get('news', TTL.content, () => this.loadAll());
    return all.filter((n) => !category || n.category === category).slice(0, max);
  }

  @Get('news/:slug')
  get(@Param('slug') slug: string): Promise<NewsDetail> {
    if (!SLUG.test(slug)) throw new BadRequestException('Endereço inválido.');
    return this.cache.get(`news:${slug}`, TTL.content, () => this.loadOne(slug));
  }

  /** Dados gerais do site: por enquanto, o último patch (faixa do topo). */
  @Get('meta')
  meta() {
    return this.cache.get('meta', TTL.content, async () => {
      const { data, error } = await this.supabase.db
        .from('patch_notes')
        .select('gid, title, published_at')
        .eq('is_patch', true)
        .order('published_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new InternalServerErrorException('Não foi possível carregar os dados do site.');
      return {
        patch: data ? { slug: `steam-${data.gid}`, title: data.title as string, published_at: data.published_at as string } : null,
      };
    });
  }

  // ───────────────────────── carregamento ─────────────────────────
  private async loadAll(): Promise<NewsItem[]> {
    const now = new Date().toISOString();
    const [articles, official] = await Promise.all([
      this.supabase.db
        .from('articles')
        .select('slug, category, title, excerpt, cover_url, published_at')
        .not('published_at', 'is', null)
        .lte('published_at', now)
        .order('published_at', { ascending: false })
        .limit(100),
      this.supabase.db
        .from('patch_notes')
        .select('gid, title, title_pt, body_raw, body_pt_md, is_patch, published_at')
        .order('published_at', { ascending: false })
        .limit(60),
    ]);
    if (articles.error || official.error) throw new InternalServerErrorException('Não foi possível carregar as notícias.');

    const items: NewsItem[] = [
      ...((articles.data ?? []) as Row[]).map((a) => ({
        slug: a['slug'],
        kind: 'article' as const,
        category: a['category'],
        title: a['title'],
        excerpt: a['excerpt'],
        cover_url: a['cover_url'],
        published_at: a['published_at'],
      })),
      ...((official.data ?? []) as Row[]).map((p) => ({
        slug: `steam-${p['gid']}`,
        kind: 'official' as const,
        // Anúncios que não são patch (eventos, votações) entram como "comunidade"
        category: (p['is_patch'] ? 'patch' : 'comunidade') as NewsCategory,
        title: p['title_pt'] || p['title'],
        excerpt: excerptFrom(p['body_pt_md'] || steamToMarkdown(p['body_raw'] ?? '')) || null,
        cover_url: null,
        published_at: p['published_at'],
      })),
    ];
    return items.sort((a, b) => b.published_at.localeCompare(a.published_at));
  }

  private async loadOne(slug: string): Promise<NewsDetail> {
    const official = slug.match(OFFICIAL);
    if (official) {
      const { data, error } = await this.supabase.db
        .from('patch_notes')
        .select('gid, title, title_pt, url, body_raw, body_pt_md, is_patch, published_at')
        .eq('gid', official[1])
        .maybeSingle();
      if (error) throw new InternalServerErrorException('Não foi possível carregar a notícia.');
      if (!data) throw new NotFoundException('Notícia não encontrada.');
      const original = steamToMarkdown(data.body_raw ?? '');
      const translated = !!data.body_pt_md;
      const body = data.body_pt_md || original;
      return {
        slug,
        kind: 'official',
        category: data.is_patch ? 'patch' : 'comunidade',
        title: data.title_pt || data.title,
        excerpt: excerptFrom(body) || null,
        cover_url: null,
        published_at: data.published_at,
        body_md: body,
        source_url: data.url,
        translated,
        original_title: translated ? data.title : null,
        original_md: translated ? original : null,
      };
    }

    const { data, error } = await this.supabase.db
      .from('articles')
      .select('slug, category, title, excerpt, cover_url, body_md, published_at')
      .eq('slug', slug)
      .maybeSingle();
    if (error) throw new InternalServerErrorException('Não foi possível carregar a notícia.');
    if (!data || !data.published_at || new Date(data.published_at) > new Date()) throw new NotFoundException('Notícia não encontrada.');
    return { ...(data as Row), kind: 'article', source_url: null, translated: false, original_title: null, original_md: null } as NewsDetail;
  }
}