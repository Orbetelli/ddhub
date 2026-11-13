import { Injectable, Logger } from '@nestjs/common';

const AUTH_URL = 'https://id.twitch.tv/oauth2/token';
const HELIX_URL = 'https://api.twitch.tv/helix';
const TIMEOUT_MS = 10_000;

export interface TwitchStream {
  user_login: string;
  user_name: string;
  game_id: string;
  game_name: string;
  title: string;
  viewer_count: number;
  started_at: string;
  thumbnail_url: string;
  type: string;
}

export interface TwitchUser {
  login: string;
  display_name: string;
  profile_image_url: string;
}

/**
 * Cliente mínimo da Twitch (Helix), com token de app (client credentials).
 * Só lê dados públicos: quem está ao vivo e a foto de perfil. Não acessa conta de ninguém.
 * Chaves em apps/api/.env: TWITCH_CLIENT_ID e TWITCH_CLIENT_SECRET.
 */
@Injectable()
export class TwitchClient {
  private readonly logger = new Logger(TwitchClient.name);
  private token: { value: string; expires: number } | null = null;

  private get clientId() {
    return process.env['TWITCH_CLIENT_ID'] ?? '';
  }

  private get clientSecret() {
    return process.env['TWITCH_CLIENT_SECRET'] ?? '';
  }

  get enabled(): boolean {
    return this.clientId.length > 0 && this.clientSecret.length > 0;
  }

  /** Streams ao vivo dos logins informados (a Twitch aceita até 100 por chamada). */
  async getStreams(logins: string[]): Promise<TwitchStream[]> {
    const out: TwitchStream[] = [];
    for (const batch of chunks(logins, 100)) {
      const query = batch.map((l) => `user_login=${encodeURIComponent(l)}`).join('&');
      const res = await this.helix<{ data: TwitchStream[] }>(`/streams?first=100&${query}`);
      out.push(...res.data.filter((s) => s.type === 'live'));
    }
    return out;
  }

  /** Perfis (foto) dos logins informados. */
  async getUsers(logins: string[]): Promise<TwitchUser[]> {
    const out: TwitchUser[] = [];
    for (const batch of chunks(logins, 100)) {
      const query = batch.map((l) => `login=${encodeURIComponent(l)}`).join('&');
      const res = await this.helix<{ data: TwitchUser[] }>(`/users?${query}`);
      out.push(...res.data);
    }
    return out;
  }

  /** ID da categoria do jogo na Twitch (ex.: "Deadlock"). */
  async getGameId(name: string): Promise<string | null> {
    const res = await this.helix<{ data: { id: string; name: string }[] }>(`/games?name=${encodeURIComponent(name)}`);
    return res.data[0]?.id ?? null;
  }

  private async helix<T>(path: string, retry = true): Promise<T> {
    const token = await this.getToken();
    const res = await fetch(`${HELIX_URL}${path}`, {
      headers: { 'Client-Id': this.clientId, Authorization: `Bearer ${token}`, 'User-Agent': 'DDhub/0.1' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401 && retry) {
      // Token vencido ou revogado: pega outro e tenta uma vez
      this.token = null;
      return this.helix<T>(path, false);
    }
    if (!res.ok) throw new Error(`Twitch ${path.split('?')[0]} respondeu ${res.status}`);
    return (await res.json()) as T;
  }

  private async getToken(): Promise<string> {
    if (this.token && this.token.expires > Date.now()) return this.token.value;

    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: 'client_credentials',
    });
    const res = await fetch(AUTH_URL, { method: 'POST', body, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`Twitch recusou as credenciais (${res.status}). Confira TWITCH_CLIENT_ID/SECRET no .env.`);
    const json = (await res.json()) as { access_token: string; expires_in: number };
    // Renova 5 min antes de vencer
    this.token = { value: json.access_token, expires: Date.now() + (json.expires_in - 300) * 1000 };
    this.logger.log('Token da Twitch obtido.');
    return this.token.value;
  }
}

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}