import { Injectable, Logger } from '@nestjs/common';

const AUTH_URL = 'https://id.kick.com/oauth/token';
const API_URL = 'https://api.kick.com/public/v1';
const TIMEOUT_MS = 10_000;
/** A Kick aceita até 50 slugs/ids por chamada. */
const BATCH = 50;

export interface KickChannel {
  slug: string;
  userId: number | null;
  title: string;
  category: string;
  live: boolean;
  viewers: number;
  startedAt: string | null;
  thumbnail: string | null;
}

type Row = Record<string, any>;

/**
 * Cliente mínimo da API pública oficial da Kick, com token de app (client credentials).
 * Só lê dados públicos: quem está ao vivo e a foto de perfil.
 * Chaves em apps/api/.env: KICK_CLIENT_ID e KICK_CLIENT_SECRET.
 */
@Injectable()
export class KickClient {
  private readonly logger = new Logger(KickClient.name);
  private token: { value: string; expires: number } | null = null;

  private get clientId() {
    return process.env['KICK_CLIENT_ID'] ?? '';
  }

  private get clientSecret() {
    return process.env['KICK_CLIENT_SECRET'] ?? '';
  }

  get enabled(): boolean {
    return this.clientId.length > 0 && this.clientSecret.length > 0;
  }

  /** Canais pelos slugs (nome na URL kick.com/<slug>), com o status da live. */
  async getChannels(slugs: string[]): Promise<KickChannel[]> {
    const out: KickChannel[] = [];
    for (const batch of chunks(slugs, BATCH)) {
      const query = batch.map((s) => `slug=${encodeURIComponent(s)}`).join('&');
      const res = await this.get<{ data?: Row[] }>(`/channels?${query}`);
      for (const c of res.data ?? []) {
        const stream = (c['stream'] ?? {}) as Row;
        out.push({
          slug: String(c['slug'] ?? '').toLowerCase(),
          userId: Number(c['broadcaster_user_id']) || null,
          title: String(c['stream_title'] ?? stream['title'] ?? ''),
          category: String((c['category'] as Row | undefined)?.['name'] ?? ''),
          live: Boolean(stream['is_live']),
          viewers: Number(stream['viewer_count'] ?? 0) || 0,
          startedAt: (stream['start_time'] as string | undefined) ?? null,
          thumbnail: (stream['thumbnail'] as string | undefined) ?? null,
        });
      }
    }
    return out;
  }

  /** Fotos de perfil pelos IDs de usuário: Map<userId, url>. */
  async getAvatars(userIds: number[]): Promise<Map<number, string>> {
    const out = new Map<number, string>();
    for (const batch of chunks(userIds, BATCH)) {
      const query = batch.map((id) => `id=${id}`).join('&');
      const res = await this.get<{ data?: Row[] }>(`/users?${query}`);
      for (const u of res.data ?? []) {
        const id = Number(u['user_id']);
        const pic = u['profile_picture'] as string | undefined;
        if (id && pic) out.set(id, pic);
      }
    }
    return out;
  }

  private async get<T>(path: string, retry = true): Promise<T> {
    const token = await this.getToken();
    const res = await fetch(`${API_URL}${path}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'User-Agent': 'DDhub/0.1' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401 && retry) {
      // Token vencido ou revogado: pega outro e tenta uma vez
      this.token = null;
      return this.get<T>(path, false);
    }
    if (!res.ok) throw new Error(`Kick ${path.split('?')[0]} respondeu ${res.status}`);
    return (await res.json()) as T;
  }

  private async getToken(): Promise<string> {
    if (this.token && this.token.expires > Date.now()) return this.token.value;

    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: 'client_credentials',
    });
    const res = await fetch(AUTH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Kick recusou as credenciais (${res.status}). Confira KICK_CLIENT_ID/SECRET no .env.`);
    const json = (await res.json()) as { access_token: string; expires_in?: number };
    const ttl = Math.max(Number(json.expires_in ?? 3600) - 300, 60);
    this.token = { value: json.access_token, expires: Date.now() + ttl * 1000 };
    this.logger.log('Token da Kick obtido.');
    return this.token.value;
  }
}

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
