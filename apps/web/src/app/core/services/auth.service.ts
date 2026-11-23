import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

/**
 * As rotas de login ficam no MESMO endereço do site (/api/auth/...):
 * na Vercel um proxy repassa para a API, e no "ng serve" o proxy.conf.json faz o mesmo.
 * Assim o cookie de sessão é do próprio site (httpOnly — o JavaScript não lê).
 */
const AUTH = '/api/auth';

export interface AuthUser {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  role: 'user' | 'moderator' | 'admin';
  providers: ('steam' | 'discord')[];
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  /** undefined = ainda carregando; null = ninguém logado */
  readonly user = signal<AuthUser | null | undefined>(undefined);

  constructor() {
    if (this.isBrowser) void this.refresh();
  }

  async refresh(): Promise<void> {
    try {
      const res = await firstValueFrom(this.http.get<{ user: AuthUser | null }>(`${AUTH}/me`));
      this.user.set(res.user ?? null);
    } catch {
      this.user.set(null);
    }
  }

  /** Link do botão "Entrar com Steam" (volta para a página atual depois). */
  steamLoginUrl(next: string): string {
    return `${AUTH}/steam?next=${encodeURIComponent(next || '/')}`;
  }

  async logout(): Promise<void> {
    try {
      await firstValueFrom(this.http.post(`${AUTH}/logout`, null));
    } finally {
      this.user.set(null);
    }
  }
}
