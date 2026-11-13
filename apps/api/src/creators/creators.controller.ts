import { Controller, Get, InternalServerErrorException } from '@nestjs/common';

import { SupabaseService } from '../supabase/supabase.service.js';
import { MemoryCache, TTL } from '../cache/memory-cache.service.js';
import { LiveService } from '../twitch/live.service.js';

export interface Creator {
  slug: string;
  name: string;
  bio_md: string;
  avatar_url: string | null;
  tags: string[];
  twitch: string | null;
  youtube: string | null;
  instagram: string | null;
  tiktok: string | null;
  kick: string | null;
  x_handle: string | null;
}

/** Streamers e YouTubers BR de Deadlock (só os publicados). */
@Controller('creators')
export class CreatorsController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly cache: MemoryCache,
    private readonly live: LiveService,
  ) {}

  @Get()
  async list(): Promise<Creator[]> {
    const creators = await this.cache.get('creators', TTL.content, () => this.load());
    // Sem foto no arquivo? Usa a da Twitch (atualizada pelo LiveService)
    return creators.map((c) => (c.avatar_url ? c : { ...c, avatar_url: this.live.avatarFor(c.twitch) }));
  }

  private async load(): Promise<Creator[]> {
    const { data, error } = await this.supabase.db
      .from('creators')
      .select('slug, name, bio_md, avatar_url, tags, twitch, youtube, instagram, tiktok, kick, x_handle')
      .not('published_at', 'is', null)
      .lte('published_at', new Date().toISOString())
      .order('position')
      .order('name');

    if (error) throw new InternalServerErrorException('Não foi possível carregar os criadores.');
    return (data ?? []) as Creator[];
  }
}