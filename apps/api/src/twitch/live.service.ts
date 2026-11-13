import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

import { SupabaseService } from '../supabase/supabase.service.js';
import { TwitchClient } from './twitch.client.js';

/** De quanto em quanto tempo pergunta à Twitch quem está ao vivo. */
const LIVE_INTERVAL_MS = 2 * 60 * 1000;
/** Fotos de perfil mudam pouco: atualiza a cada 6 horas. */
const AVATAR_INTERVAL_MS = 6 * 60 * 60 * 1000;
const GAME_NAME = 'Deadlock';

export interface LiveStream {
  slug: string;
  name: string;
  twitch: string;
  avatar: string | null;
  title: string;
  viewers: number;
  started_at: string;
  thumbnail: string;
  url: string;
}

export interface LiveSnapshot {
  /** false enquanto as chaves da Twitch não estiverem no .env */
  enabled: boolean;
  updated_at: string | null;
  streams: LiveStream[];
}

interface CreatorRow {
  slug: string;
  name: string;
  twitch: string;
}

/**
 * "Ao vivo agora": a cada 2 minutos pergunta à Twitch quais criadores publicados
 * estão em live na categoria Deadlock. O site lê o resultado daqui (GET /live),
 * então o número de visitantes não muda o número de chamadas à Twitch.
 */
@Injectable()
export class LiveService implements OnApplicationBootstrap {
  private readonly logger = new Logger(LiveService.name);
  private snapshot: LiveSnapshot = { enabled: false, updated_at: null, streams: [] };
  private avatars = new Map<string, string>();
  private avatarsAt = 0;
  /** Logins da última busca de fotos: se entrar criador novo, busca de novo. */
  private avatarLogins = '';
  private gameId: string | null = null;
  private running = false;
  private warned = false;

  constructor(
    private readonly twitch: TwitchClient,
    private readonly supabase: SupabaseService,
  ) {}

  onApplicationBootstrap(): void {
    void this.refresh();
  }

  get current(): LiveSnapshot {
    return this.snapshot;
  }

  /** Foto de perfil da Twitch por login (minúsculo). */
  avatarFor(login: string | null): string | null {
    return login ? (this.avatars.get(login.toLowerCase()) ?? null) : null;
  }

  @Interval(LIVE_INTERVAL_MS)
  async refresh(): Promise<void> {
    if (!this.twitch.enabled) {
      if (!this.warned) {
        this.logger.warn('Ao vivo desligado: defina TWITCH_CLIENT_ID e TWITCH_CLIENT_SECRET no .env.');
        this.warned = true;
      }
      return;
    }
    if (this.running) return;
    this.running = true;

    try {
      const creators = await this.loadCreators();
      const logins = creators.map((c) => c.twitch.toLowerCase());
      if (logins.length === 0) {
        this.snapshot = { enabled: true, updated_at: new Date().toISOString(), streams: [] };
        return;
      }

      const loginKey = [...logins].sort().join(',');
      if (Date.now() - this.avatarsAt > AVATAR_INTERVAL_MS || loginKey !== this.avatarLogins) {
        await this.refreshAvatars(logins);
        this.avatarLogins = loginKey;
      }
      this.gameId ??= await this.twitch.getGameId(GAME_NAME);

      const byLogin = new Map(creators.map((c) => [c.twitch.toLowerCase(), c]));
      const streams = (await this.twitch.getStreams(logins))
        // Só lives de Deadlock (pelo ID da categoria; pelo nome se o ID não vier)
        .filter((s) => (this.gameId ? s.game_id === this.gameId : s.game_name.toLowerCase() === GAME_NAME.toLowerCase()))
        .flatMap((s): LiveStream[] => {
          const c = byLogin.get(s.user_login.toLowerCase());
          if (!c) return [];
          return [
            {
              slug: c.slug,
              name: c.name,
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
        })
        .sort((a, b) => b.viewers - a.viewers);

      this.snapshot = { enabled: true, updated_at: new Date().toISOString(), streams };
    } catch (err) {
      // Mantém o último resultado; tenta de novo no próximo ciclo
      this.logger.warn(`Ao vivo: ${String(err)}`);
      this.snapshot = { ...this.snapshot, enabled: true };
    } finally {
      this.running = false;
    }
  }

  private async refreshAvatars(logins: string[]): Promise<void> {
    try {
      const users = await this.twitch.getUsers(logins);
      this.avatars = new Map(users.map((u) => [u.login.toLowerCase(), u.profile_image_url]));
      this.avatarsAt = Date.now();
    } catch (err) {
      this.logger.warn(`Fotos da Twitch: ${String(err)}`);
    }
  }

  private async loadCreators(): Promise<CreatorRow[]> {
    const { data, error } = await this.supabase.db
      .from('creators')
      .select('slug, name, twitch')
      .not('twitch', 'is', null)
      .not('published_at', 'is', null)
      .lte('published_at', new Date().toISOString());
    if (error) throw new Error(`criadores: ${error.message}`);
    return (data ?? []) as CreatorRow[];
  }
}