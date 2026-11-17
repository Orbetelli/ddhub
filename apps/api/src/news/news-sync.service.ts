import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { SupabaseService } from '../supabase/supabase.service.js';
import { MemoryCache } from '../cache/memory-cache.service.js';

/** Deadlock na Steam. */
const STEAM_APP_ID = 1422450;
const STEAM_NEWS_URL = 'https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/';

interface SteamNewsItem {
  gid: string;
  title: string;
  url: string;
  author?: string;
  contents?: string;
  feedname?: string;
  date: number; // segundos (unix)
}

/** Título que parece nota de atualização do jogo. */
const PATCH_TITLE = /update|patch|hotfix|changelog|atualiza/i;

/**
 * Importa os anúncios oficiais do Deadlock da Steam (de hora em hora e ao subir a API).
 * Só lê a API pública de notícias da Steam: não precisa de chave.
 */
@Injectable()
export class NewsSyncService implements OnApplicationBootstrap {
  private readonly logger = new Logger(NewsSyncService.name);
  private running = false;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly cache: MemoryCache,
  ) {}

  onApplicationBootstrap(): void {
    void this.sync();
  }

  @Cron('17 * * * *') // de hora em hora, fora do minuto 0
  async sync(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const params = new URLSearchParams({
        appid: String(STEAM_APP_ID),
        count: '30',
        maxlength: '0', // texto completo
        feeds: 'steam_community_announcements', // só anúncios oficiais
        format: 'json',
      });
      const res = await fetch(`${STEAM_NEWS_URL}?${params}`, {
        headers: { 'User-Agent': 'DDhub/0.1' },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`Steam respondeu ${res.status}`);
      const json = (await res.json()) as { appnews?: { newsitems?: SteamNewsItem[] } };
      const items = json.appnews?.newsitems ?? [];

      const rows = items
        .filter((n) => n.gid && n.title && /^https:\/\//.test(n.url ?? ''))
        .map((n) => ({
          gid: String(n.gid),
          title: n.title.trim().slice(0, 300),
          url: n.url,
          author: n.author ?? null,
          body_raw: n.contents ?? '',
          is_patch: PATCH_TITLE.test(n.title),
          published_at: new Date(n.date * 1000).toISOString(),
          synced_at: new Date().toISOString(),
        }));

      if (rows.length) {
        const { error } = await this.supabase.db.from('patch_notes').upsert(rows, { onConflict: 'gid' });
        if (error) throw new Error(error.message);
        this.cache.clear();
      }
      this.logger.log(`Notícias da Steam: ${rows.length} anúncios (${rows.filter((r) => r.is_patch).length} de patch).`);
      return rows.length;
    } catch (err) {
      this.logger.warn(`Notícias da Steam: ${String(err)}`);
      return 0;
    } finally {
      this.running = false;
    }
  }
}