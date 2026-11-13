import {
  BadRequestException,
  Controller,
  Get,
  InternalServerErrorException,
  NotFoundException,
  Param,
} from '@nestjs/common';

import { SupabaseService } from '../supabase/supabase.service.js';
import { MemoryCache, TTL } from '../cache/memory-cache.service.js';

const SLUG = /^[a-z0-9-]{1,60}$/;

interface ChapterSummary {
  slug: string;
  position: number;
  title: string;
  summary: string | null;
}

/** Guia "Aprender a jogar" — só capítulos publicados. */
@Controller('learn')
export class LearnController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly cache: MemoryCache,
  ) {}

  @Get()
  list(): Promise<ChapterSummary[]> {
    return this.publishedSummaries();
  }

  @Get(':slug')
  get(@Param('slug') slug: string) {
    if (!SLUG.test(slug)) throw new BadRequestException('Slug inválido.');
    return this.cache.get(`learn:${slug}`, TTL.content, () => this.loadChapter(slug));
  }

  private async loadChapter(slug: string) {
    const { data, error } = await this.supabase.db
      .from('learn_chapters')
      .select('slug, position, title, summary, body_md, updated_at, published_at')
      .eq('slug', slug)
      .maybeSingle();

    if (error) throw new InternalServerErrorException('Não foi possível carregar o capítulo.');
    if (!data || !data.published_at || new Date(data.published_at) > new Date()) {
      throw new NotFoundException('Capítulo não encontrado.');
    }

    // Anterior / próximo para a navegação no rodapé do capítulo
    const all = await this.publishedSummaries();
    const index = all.findIndex((c) => c.slug === slug);

    return {
      slug: data.slug,
      position: data.position,
      title: data.title,
      summary: data.summary,
      body_md: data.body_md,
      updated_at: data.updated_at,
      prev: index > 0 ? all[index - 1] : null,
      next: index >= 0 && index < all.length - 1 ? all[index + 1] : null,
    };
  }

  private publishedSummaries(): Promise<ChapterSummary[]> {
    return this.cache.get('learn', TTL.content, () => this.loadSummaries());
  }

  private async loadSummaries(): Promise<ChapterSummary[]> {
    const { data, error } = await this.supabase.db
      .from('learn_chapters')
      .select('slug, position, title, summary')
      .not('published_at', 'is', null)
      .lte('published_at', new Date().toISOString())
      .order('position');

    if (error) throw new InternalServerErrorException('Não foi possível carregar o guia.');
    return (data ?? []) as ChapterSummary[];
  }
}