import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, Observable } from 'rxjs';

import { API_BASE_URL } from '../api.config';
import { AuthService } from './auth.service';

/** Rotas com cookie de sessão passam pelo próprio site (/api/auth, proxy da Vercel). */
const AUTH = '/api/auth';

export interface PublicProfile {
  username: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  created_at: string;
  staff: boolean;
}

export interface AccountData {
  generated_at: string;
  user: {
    id: string;
    username: string;
    display_name: string;
    avatar_url: string | null;
    bio: string | null;
    role: string;
    created_at: string;
    updated_at: string;
  };
  identities: {
    provider: 'steam' | 'discord';
    provider_user_id: string;
    provider_username: string | null;
    provider_avatar_url: string | null;
    linked_at: string;
    last_login_at: string | null;
  }[];
  sessions: { provider: string; created_at: string; last_seen_at: string; expires_at: string }[];
}

export interface AccountPatch {
  display_name?: string;
  username?: string;
  bio?: string;
}

@Injectable({ providedIn: 'root' })
export class AccountService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_BASE_URL);
  private readonly auth = inject(AuthService);

  profile(username: string): Observable<PublicProfile> {
    return this.http.get<PublicProfile>(`${this.api}/users/${encodeURIComponent(username)}`);
  }

  account(): Promise<AccountData> {
    return firstValueFrom(this.http.get<AccountData>(`${AUTH}/account`));
  }

  async update(patch: AccountPatch): Promise<void> {
    await firstValueFrom(this.http.patch(`${AUTH}/account`, patch));
    await this.auth.refresh();
  }

  async logoutAll(): Promise<void> {
    await firstValueFrom(this.http.post(`${AUTH}/logout-all`, null));
    this.auth.user.set(null);
  }

  async remove(confirm: string): Promise<void> {
    await firstValueFrom(this.http.delete(`${AUTH}/account`, { body: { confirm } }));
    this.auth.user.set(null);
  }
}

/** Mensagem de erro da API (Nest manda { message }) ou uma genérica. */
export function apiError(err: unknown, fallback = 'Algo deu errado. Tente de novo.'): string {
  const m = (err as { error?: { message?: unknown } })?.error?.message;
  return typeof m === 'string' ? m : Array.isArray(m) && typeof m[0] === 'string' ? m[0] : fallback;
}
