import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';

import { SupabaseService } from '../supabase/supabase.service.js';

export const SESSION_COOKIE = 'ddhub_session';
export const STATE_COOKIE = 'ddhub_login_state';
/** Quanto tempo a pessoa fica logada sem precisar entrar de novo. */
export const SESSION_DAYS = 30;

export type Provider = 'steam' | 'discord';

export interface SessionUser {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  role: 'user' | 'moderator' | 'admin';
  providers: Provider[];
}

type Row = Record<string, any>;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Endereço público do site (onde o cookie vive). Local: http://localhost:4200 */
export function webUrl(): string {
  return (process.env['PUBLIC_WEB_URL'] ?? 'https://ddhub-br.vercel.app').replace(/\/+$/, '');
}

/** Lê um cookie do cabeçalho "Cookie" sem dependência extra. */
export function readCookie(header: string | undefined, name: string): string | null {
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/** Monta o Set-Cookie com as travas de segurança (httpOnly, SameSite=Lax, Secure em https). */
export function cookie(name: string, value: string, maxAgeSeconds: number, path = '/'): string {
  const secure = webUrl().startsWith('https://') ? '; Secure' : '';
  return `${name}=${encodeURIComponent(value)}; Path=${path}; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Lax${secure}`;
}

/**
 * Sessões: o navegador guarda um token aleatório de 256 bits num cookie httpOnly
 * (o JavaScript do site não lê). No banco fica só o hash desse token.
 */
@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(private readonly supabase: SupabaseService) {}

  /** Cria a sessão e devolve o token (que vai só para o cookie). */
  async create(userId: string, provider: Provider): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { error } = await this.supabase.db
      .from('user_sessions')
      .insert({ user_id: userId, token_hash: sha256(token), provider, expires_at: expires });
    if (error) throw new Error(`sessão: ${error.message}`);
    // Faxina ocasional de sessões vencidas
    if (Math.random() < 0.05) void this.supabase.db.from('user_sessions').delete().lt('expires_at', new Date().toISOString());
    return token;
  }

  /** Quem é o dono desse token? null se não existir, venceu ou a conta foi banida/excluída. */
  async user(token: string | null): Promise<SessionUser | null> {
    if (!token || token.length < 40 || token.length > 60) return null;
    const { data, error } = await this.supabase.db
      .from('user_sessions')
      .select('id, expires_at, last_seen_at, users(id, username, display_name, avatar_url, role, is_banned, deleted_at, user_identities(provider))')
      .eq('token_hash', sha256(token))
      .maybeSingle();
    if (error || !data) return null;
    const u = data.users as Row | null;
    if (!u || u['is_banned'] || u['deleted_at'] || Date.parse(data.expires_at) < Date.now()) {
      await this.supabase.db.from('user_sessions').delete().eq('id', data.id);
      return null;
    }
    // Marca "visto por último" no máximo 1x por hora
    if (Date.now() - Date.parse(data.last_seen_at) > 60 * 60 * 1000) {
      void this.supabase.db.from('user_sessions').update({ last_seen_at: new Date().toISOString() }).eq('id', data.id);
    }
    return {
      id: u['id'],
      username: u['username'],
      display_name: u['display_name'],
      avatar_url: u['avatar_url'],
      role: u['role'],
      providers: ((u['user_identities'] ?? []) as Row[]).map((i) => i['provider']),
    };
  }

  async destroy(token: string | null): Promise<void> {
    if (!token) return;
    const { error } = await this.supabase.db.from('user_sessions').delete().eq('token_hash', sha256(token));
    if (error) this.logger.warn(`Erro ao encerrar sessão: ${error.message}`);
  }
}
