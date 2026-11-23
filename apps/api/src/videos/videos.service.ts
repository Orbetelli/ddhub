import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

import { SupabaseService } from '../supabase/supabase.service.js';

/** A cada 30 min busca os vídeos novos (RSS público do YouTube, sem chave). */
const REFRESH_MS = 30 * 60 * 1000;
/** O ID do canal (UC…) muda nunca: descobre uma vez por dia. */
const CHANNEL_ID_TTL = 24 * 60 * 60 * 1000;
/** Só vídeos dos últimos 45 dias. */
const MAX_AGE_MS = 45 * 24 * 60 * 60 * 1000;
const MAX_VIDEOS = 60;
const UA = 'Mozilla/5.0 (compatible; DDhub/0.1; +https://ddhub-br.vercel.app)';

export interface Video {
  id: string;
  title: string;
  url: string;
  thumbnail: string;
  published_at: string;
  creator: { slug: string; name: string; avatar_url: string | null };
}

type Row = Record<string, any>;

/**
 * Feed de vídeos BR: últimos vídeos de Deadlock dos criadores com YouTube no DDhub.
 * Usa o RSS público de cada canal (youtube.com/feeds/videos.xml) — sem chave, sem cota.
 * Só entram vídeos com "Deadlock" ou o nome de um herói no título.
 */
@Injectable()
export class VideosService implements OnApplicationBootstrap {
  private readonly logger = new Logger(VideosService.name);
  private videos: Video[] = [];
  private updatedAt: string | null = null;
  private channelIds = new Map<string, { id: string | null; at: number }>();
  private running = false;

  constructor(private readonly supabase: SupabaseService) {}

  onApplicationBootstrap(): void {
    // Espera um pouco para não disputar com os outros syncs do boot
    setTimeout(() => void this.refresh(), 20_000);
  }

  get current() {
    return { updated_at: this.updatedAt, videos: this.videos };
  }

  @Interval(REFRESH_MS)
  async refresh(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const [{ data: creators, error }, { data: heroes }] = await Promise.all([
        this.supabase.db
          .from('creators')
          .select('slug, name, youtube, avatar_url')
          .not('youtube', 'is', null)
          .not('published_at', 'is', null)
          .lte('published_at', new Date().toISOString()),
        this.supabase.db.from('hero_cards').select('name, name_en'),
      ]);
      if (error) throw new Error(error.message);

      const keywords = buildKeywords((heroes ?? []) as Row[]);
      const all: Video[] = [];
      for (const c of (creators ?? []) as Row[]) {
        try {
          const channelId = await this.channelId(c['youtube']);
          if (!channelId) continue;
          const entries = await this.feed(channelId);
          for (const e of entries) {
            if (!keywords.test(e.title)) continue;
            if (Date.now() - Date.parse(e.published) > MAX_AGE_MS) continue;
            all.push({
              id: e.id,
              title: e.title,
              url: `https://www.youtube.com/watch?v=${e.id}`,
              thumbnail: `https://i.ytimg.com/vi/${e.id}/hqdefault.jpg`,
              published_at: e.published,
              creator: { slug: c['slug'], name: c['name'], avatar_url: c['avatar_url'] ?? null },
            });
          }
        } catch (err) {
          this.logger.warn(`Vídeos de ${c['name']}: ${err instanceof Error ? err.message : String(err)}`);
        }
        await sleep(400); // educado com o YouTube
      }
      this.videos = all.sort((a, b) => b.published_at.localeCompare(a.published_at)).slice(0, MAX_VIDEOS);
      this.updatedAt = new Date().toISOString();
      this.logger.log(`Vídeos BR: ${this.videos.length} vídeos de Deadlock.`);
    } catch (err) {
      this.logger.warn(`Vídeos BR: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.running = false;
    }
  }

  /** @handle → UC… (lendo a página pública do canal). */
  private async channelId(handle: string): Promise<string | null> {
    const key = handle.toLowerCase();
    const cached = this.channelIds.get(key);
    if (cached && Date.now() - cached.at < CHANNEL_ID_TTL) return cached.id;

    let id: string | null = null;
    if (/^UC[\w-]{22}$/.test(handle)) {
      id = handle;
    } else {
      const res = await fetch(`https://www.youtube.com/@${encodeURIComponent(handle)}`, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9', Cookie: 'CONSENT=YES+1' },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) {
        const html = await res.text();
        id =
          /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/.exec(html)?.[1] ??
          /"externalId":"(UC[\w-]{22})"/.exec(html)?.[1] ??
          /"channelId":"(UC[\w-]{22})"/.exec(html)?.[1] ??
          null;
      }
      if (!id) this.logger.warn(`Canal do YouTube não encontrado: @${handle}`);
    }
    this.channelIds.set(key, { id, at: Date.now() });
    return id;
  }

  private async feed(channelId: string): Promise<{ id: string; title: string; published: string }[]> {
    const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`RSS respondeu ${res.status}`);
    const xml = await res.text();
    const out: { id: string; title: string; published: string }[] = [];
    for (const entry of xml.split('<entry>').slice(1)) {
      const id = /<yt:videoId>([\w-]{11})<\/yt:videoId>/.exec(entry)?.[1];
      const title = /<title>([\s\S]*?)<\/title>/.exec(entry)?.[1];
      const published = /<published>([^<]+)<\/published>/.exec(entry)?.[1];
      if (!id || !title || !published || Number.isNaN(Date.parse(published))) continue;
      // Shorts também entram (o RSS não separa); o título já filtra o que é de Deadlock
      out.push({ id, title: decodeXml(title).trim(), published: new Date(published).toISOString() });
    }
    return out;
  }
}

/** "deadlock" ou o nome de qualquer herói (PT ou EN), palavra inteira. */
export function buildKeywords(heroes: Row[]): RegExp {
  const names = new Set<string>(['deadlock']);
  for (const h of heroes) {
    for (const n of [h['name'], h['name_en']]) if (typeof n === 'string' && n.trim().length >= 3) names.add(n.trim());
  }
  const alt = [...names]
    .map((n) => n.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s*&\s*/g, '\\s*(?:&|and|e)\\s*'))
    .join('|');
  const re = new RegExp(`(^|[^a-z0-9])(${alt})([^a-z0-9]|$)`, 'i');
  // Compara sem acento
  return { test: (s: string) => re.test(s.normalize('NFD').replace(/[̀-ͯ]/g, '')) } as RegExp;
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
