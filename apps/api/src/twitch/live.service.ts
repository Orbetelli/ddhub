import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

import { SupabaseService } from '../supabase/supabase.service.js';
import { TwitchClient } from './twitch.client.js';
import { KickClient } from './kick.client.js';

/** De quanto em quanto tempo pergunta à Twitch e à Kick quem está ao vivo. */
const LIVE_INTERVAL_MS = 2 * 60 * 1000;
/** Fotos de perfil mudam pouco: atualiza a cada 6 horas. */
const AVATAR_INTERVAL_MS = 6 * 60 * 60 * 1000;
const GAME_NAME = 'Deadlock';

export type Platform = 'twitch' | 'kick';

export interface LiveStream {
  slug: string;
  name: string;
  platform: Platform;
  /** Usuário no canal da plataforma (login da Twitch ou slug da Kick). */
  twitch: string;
  avatar: string | null;
  title: string;
  viewers: number;
  started_at: string;
  thumbnail: string;
  url: string;
}

export interface LiveSnapshot {
  /** false enquanto nenhuma integração (Twitch ou Kick) estiver configurada no .env */
  enabled: boolean;
  updated_at: string | null;
  streams: LiveStream[];
}

interface CreatorRow {
  slug: string;
  name: string;
  twitch: string | null;
  kick: string | null;
}

/**
 * "Ao vivo agora": a cada 2 minutos pergunta à Twitch e à Kick quais criadores publicados
 * estão em live na categoria Deadlock. O site lê o resultado daqui (GET /live),
 * então o número de visitantes não muda o número de chamadas às plataformas.
 * Cada plataforma é independente: se uma falhar, a outra continua aparecendo.
 */
@Injectable()
export class LiveService implements OnApplicationBootstrap {
  private readonly logger = new Logger(LiveService.name);
  private snapshot: LiveSnapshot = { enabled: false, updated_at: null, streams: [] };
  private twitchStreams: LiveStream[] = [];
  private kickStreams: LiveStream[] = [];

  private twitchAvatars = new Map<string, string>();
  private twitchAvatarsAt = 0;
  private twitchAvatarKey = '';
  private kickAvatars = new Map<string, string>();
  private kickAvatarsAt = 0;
  private kickAvatarKey = '';

  private gameId: string | null = null;
  private running = false;
  private warned = false;

  constructor(
    private readonly twitch: TwitchClient,
    private readonly kick: KickClient,
    private readonly supabase: SupabaseService,
  ) {}

  onApplicationBootstrap(): void {
    void this.refresh();
  }

  get current(): LiveSnapshot {
    return this.snapshot;
  }

  /** Foto de perfil da Twitch por login. */
  avatarFor(login: string | null): string | null {
    return login ? (this.twitchAvatars.get(login.toLowerCase()) ?? null) : null;
  }

  /** Foto de perfil da Kick por slug. */
  kickAvatarFor(slug: string | null): string | null {
    return slug ? (this.kickAvatars.get(slug.toLowerCase()) ?? null) : null;
  }

  @Interval(LIVE_INTERVAL_MS)
  async refresh(): Promise<void> {
    const enabled = this.twitch.enabled || this.kick.enabled;
    if (!enabled) {
      if (!this.warned) {
        this.logger.warn('Ao vivo desligado: defina TWITCH_CLIENT_ID/SECRET e/ou KICK_CLIENT_ID/SECRET no .env.');
        this.warned = true;
      }
      return;
    }
    if (this.running) return;
    this.running = true;

    try {
      const creators = await this.loadCreators();
      await Promise.all([this.refreshTwitch(creators), this.refreshKick(creators)]);
      const streams = [...this.twitchStreams, ...this.kickStreams].sort((a, b) => b.viewers - a.viewers);
      this.snapshot = { enabled: true, updated_at: new Date().toISOString(), streams };
    } catch (err) {
      // Mantém o último resultado; tenta de novo no próximo ciclo
      this.logger.warn(`Ao vivo: ${String(err)}`);
      this.snapshot = { ...this.snapshot, enabled: true };
    } finally {
      this.running = false;
    }
  }

  // ───────────────────────── Twitch ─────────────────────────
  private async refreshTwitch(creators: CreatorRow[]): Promise<void> {
    if (!this.twitch.enabled) return;
    try {
      const list = creators.filter((c) => c.twitch);
      const logins = list.map((c) => c.twitch!.toLowerCase());
      if (logins.length === 0) {
        this.twitchStreams = [];
        return;
      }

      const key = [...logins].sort().join(',');
      if (Date.now() - this.twitchAvatarsAt > AVATAR_INTERVAL_MS || key !== this.twitchAvatarKey) {
        try {
          const users = await this.twitch.getUsers(logins);
          this.twitchAvatars = new Map(users.map((u) => [u.login.toLowerCase(), u.profile_image_url]));
          this.twitchAvatarsAt = Date.now();
          this.twitchAvatarKey = key;
        } catch (err) {
          this.logger.warn(`Fotos da Twitch: ${String(err)}`);
        }
      }
      this.gameId ??= await this.twitch.getGameId(GAME_NAME);

      const byLogin = new Map(list.map((c) => [c.twitch!.toLowerCase(), c]));
      this.twitchStreams = (await this.twitch.getStreams(logins))
        // Só lives de Deadlock (pelo ID da categoria; pelo nome se o ID não vier)
        .filter((s) => (this.gameId ? s.game_id === this.gameId : s.game_name.toLowerCase() === GAME_NAME.toLowerCase()))
        .flatMap((s): LiveStream[] => {
          const c = byLogin.get(s.user_login.toLowerCase());
          if (!c) return [];
          return [
            {
              slug: c.slug,
              name: c.name,
              platform: 'twitch',
              twitch: s.user_login,
              avatar: this.avatarFor(s.user_login),
              title: s.title,
              viewers: s.viewer_count,
              started_at: s.started_at,
              // Cache-buster por minuto: a miniatura da Twitch muda durante a live
              thumbnail: `${s.thumbnail_url.replace('{width}', '440').replace('{height}', '248')}?t=${Math.floor(Date.now() / 60000)}`,
              url: `https://www.twitch.tv/${encodeURIComponent(s.user_login)}`,
            },
          ];
        });
    } catch (err) {
      this.logger.warn(`Ao vivo (Twitch): ${String(err)}`);
    }
  }

  // ───────────────────────── Kick ─────────────────────────
  private async refreshKick(creators: CreatorRow[]): Promise<void> {
    if (!this.kick.enabled) return;
    try {
      const list = creators.filter((c) => c.kick);
      const slugs = list.map((c) => c.kick!.toLowerCase());
      if (slugs.length === 0) {
        this.kickStreams = [];
        return;
      }

      // Uma chamada só traz o status da live e o id do dono (usado para a foto)
      const channels = await this.kick.getChannels(slugs);

      const key = [...slugs].sort().join(',');
      if (Date.now() - this.kickAvatarsAt > AVATAR_INTERVAL_MS || key !== this.kickAvatarKey) {
        try {
          const ids = channels.map((c) => c.userId).filter((id): id is number => !!id);
          const pics = await this.kick.getAvatars(ids);
          this.kickAvatars = new Map(
            channels.filter((c) => c.userId && pics.has(c.userId)).map((c) => [c.slug, pics.get(c.userId!)!]),
          );
          this.kickAvatarsAt = Date.now();
          this.kickAvatarKey = key;
        } catch (err) {
          this.logger.warn(`Fotos da Kick: ${String(err)}`);
        }
      }

      const bySlug = new Map(list.map((c) => [c.kick!.toLowerCase(), c]));
      this.kickStreams = channels
        .filter((ch) => ch.live && ch.category.toLowerCase() === GAME_NAME.toLowerCase())
        .flatMap((ch): LiveStream[] => {
          const c = bySlug.get(ch.slug);
          if (!c) return [];
          const avatar = this.kickAvatarFor(ch.slug);
          return [
            {
              slug: c.slug,
              name: c.name,
              platform: 'kick',
              twitch: ch.slug,
              avatar,
              title: ch.title,
              viewers: ch.viewers,
              started_at: ch.startedAt ?? new Date().toISOString(),
              thumbnail: ch.thumbnail ?? avatar ?? '',
              url: `https://kick.com/${encodeURIComponent(ch.slug)}`,
            },
          ];
        });
    } catch (err) {
      this.logger.warn(`Ao vivo (Kick): ${String(err)}`);
    }
  }

  private async loadCreators(): Promise<CreatorRow[]> {
    const { data, error } = await this.supabase.db
      .from('creators')
      .select('slug, name, twitch, kick')
      .or('twitch.not.is.null,kick.not.is.null')
      .not('published_at', 'is', null)
      .lte('published_at', new Date().toISOString());
    if (error) throw new Error(`criadores: ${error.message}`);
    return (data ?? []) as CreatorRow[];
  }
}
