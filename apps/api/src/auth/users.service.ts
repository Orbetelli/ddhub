import { Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';

import { SupabaseService } from '../supabase/supabase.service.js';
import type { Provider } from './session.service.js';

export interface ProviderProfile {
  provider: Provider;
  /** SteamID64 ou ID do Discord */
  id: string;
  name: string | null;
  avatar: string | null;
}

export class BannedError extends Error {}

/**
 * Contas do DDhub. Uma conta Steam (ou Discord) = um usuário.
 * Guardamos só o que a plataforma mostra publicamente: ID, nome e avatar.
 */
@Injectable()
export class UsersService {
  constructor(private readonly supabase: SupabaseService) {}

  /** Acha o usuário dessa conta Steam/Discord ou cria um novo. Devolve o id. */
  async findOrCreate(p: ProviderProfile): Promise<string> {
    const db = this.supabase.db;
    const now = new Date().toISOString();

    const { data: identity, error } = await db
      .from('user_identities')
      .select('user_id, users(is_banned, deleted_at)')
      .eq('provider', p.provider)
      .eq('provider_user_id', p.id)
      .maybeSingle();
    if (error) throw new Error(`identidade: ${error.message}`);

    if (identity) {
      const u = identity.users as { is_banned?: boolean; deleted_at?: string | null } | null;
      if (u?.is_banned) throw new BannedError('conta suspensa');
      // Atualiza nome/avatar da plataforma (o nome de exibição no DDhub não muda sozinho)
      await db
        .from('user_identities')
        .update({ provider_username: p.name, provider_avatar_url: p.avatar, last_login_at: now })
        .eq('provider', p.provider)
        .eq('provider_user_id', p.id);
      if (p.avatar) await db.from('users').update({ avatar_url: p.avatar }).eq('id', identity.user_id);
      if (u?.deleted_at) {
        // Conta excluída antes: reativa como nova
        await db.from('users').update({ deleted_at: null }).eq('id', identity.user_id);
      }
      return identity.user_id as string;
    }

    // Conta nova
    const display = (p.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 40) || 'Jogador';
    for (let attempt = 0; attempt < 5; attempt++) {
      const username = this.username(display, attempt);
      const { data: user, error: uErr } = await db
        .from('users')
        .insert({ username, display_name: display, avatar_url: p.avatar })
        .select('id')
        .single();
      if (uErr) {
        if (uErr.code === '23505') continue; // username já existe: tenta outro
        throw new Error(`usuário: ${uErr.message}`);
      }
      const { error: iErr } = await db.from('user_identities').insert({
        user_id: user.id,
        provider: p.provider,
        provider_user_id: p.id,
        provider_username: p.name,
        provider_avatar_url: p.avatar,
        last_login_at: now,
      });
      if (iErr) {
        await db.from('users').delete().eq('id', user.id);
        throw new Error(`identidade: ${iErr.message}`);
      }
      return user.id as string;
    }
    throw new Error('não foi possível escolher um nome de usuário');
  }

  /** "João Silva!" → "JoaoSilva"; curto demais → "jogador"; conflito → sufixo numérico. */
  private username(display: string, attempt: number): string {
    let base = display
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9_]/g, '')
      .slice(0, 18);
    if (base.length < 3) base = 'jogador';
    return attempt === 0 ? base : `${base}${randomInt(1000, 9999)}`;
  }
}
