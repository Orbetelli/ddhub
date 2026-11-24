#!/usr/bin/env bash
# Perfil (/u/<@>) e Minha conta (/conta): editar perfil, sair de todos, baixar dados, excluir conta
# Rode na raiz do repositório:  cd ~/ddhub && bash aplicar-conta.sh
set -e
[ -d apps/api/src/auth ] || { echo "Rode na raiz do repositório (cd ~/ddhub)."; exit 1; }
mkdir -p apps/web/src/app/features/account

cat > 'apps/api/src/auth/account.controller.ts' <<'DDHUB_EOF'
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';

import { SupabaseService } from '../supabase/supabase.service.js';
import { SESSION_COOKIE, SessionService, cookie, readCookie, webUrl } from './session.service.js';
import type { SessionUser } from './session.service.js';

interface HttpReq {
  headers: Record<string, string | string[] | undefined>;
}
interface HttpRes {
  setHeader(name: string, value: string | string[]): unknown;
}

type Row = Record<string, any>;

const USERNAME = /^[A-Za-z0-9_]{3,24}$/;
/** Nomes que não podem ser escolhidos (confundem com a equipe ou com páginas do site). */
const RESERVED = new Set(['admin', 'administrador', 'moderador', 'moderator', 'ddhub', 'suporte', 'support', 'valve', 'steam', 'sistema', 'system', 'root', 'null', 'undefined', 'conta', 'perfil']);

/**
 * Conta e perfil.
 *   GET    /users/:username    → perfil público (nome, @, foto, bio, desde quando)
 *   GET    /auth/account       → todos os seus dados (página da conta e "baixar meus dados")
 *   PATCH  /auth/account       → muda nome de exibição, @ e bio
 *   POST   /auth/logout-all    → sai de todos os aparelhos
 *   DELETE /auth/account       → exclui a conta de verdade (LGPD), pede o @ para confirmar
 */
@Controller()
export class AccountController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly sessions: SessionService,
  ) {}

  @Get('users/:username')
  async publicProfile(@Param('username') username: string) {
    if (!USERNAME.test(username ?? '')) throw new NotFoundException('Perfil não encontrado.');
    const { data, error } = await this.supabase.db
      .from('users')
      .select('username, display_name, avatar_url, bio, created_at, role, is_banned, deleted_at')
      .eq('username', username) // citext: não diferencia maiúsculas
      .maybeSingle();
    if (error) throw new InternalServerErrorException('Perfil indisponível no momento.');
    if (!data || data['deleted_at'] || data['is_banned']) throw new NotFoundException('Perfil não encontrado.');
    return {
      username: data['username'],
      display_name: data['display_name'],
      avatar_url: data['avatar_url'],
      bio: data['bio'],
      created_at: data['created_at'],
      staff: data['role'] === 'admin' || data['role'] === 'moderator',
    };
  }

  @Get('auth/account')
  async account(@Req() req: HttpReq, @Res({ passthrough: true }) res: HttpRes) {
    res.setHeader('Cache-Control', 'no-store');
    const me = await this.me(req);
    const db = this.supabase.db;
    const [user, identities, sessions] = await Promise.all([
      db.from('users').select('id, username, display_name, avatar_url, bio, role, created_at, updated_at').eq('id', me.id).single(),
      db.from('user_identities').select('provider, provider_user_id, provider_username, provider_avatar_url, linked_at, last_login_at').eq('user_id', me.id),
      db.from('user_sessions').select('provider, created_at, last_seen_at, expires_at').eq('user_id', me.id).order('created_at', { ascending: false }),
    ]);
    if (user.error || identities.error || sessions.error) throw new InternalServerErrorException('Conta indisponível no momento.');
    return {
      generated_at: new Date().toISOString(),
      user: user.data,
      identities: identities.data ?? [],
      sessions: sessions.data ?? [],
    };
  }

  @Patch('auth/account')
  async update(@Req() req: HttpReq, @Body() body: { display_name?: unknown; username?: unknown; bio?: unknown }) {
    sameOrigin(req);
    const me = await this.me(req);
    const patch: Row = {};

    if (body?.display_name !== undefined) {
      const name = cleanLine(body.display_name);
      if (name.length < 1 || name.length > 40) throw new BadRequestException('O nome precisa ter de 1 a 40 caracteres.');
      patch['display_name'] = name;
    }
    if (body?.bio !== undefined) {
      const bio = cleanText(body.bio);
      if (bio.length > 280) throw new BadRequestException('A bio pode ter até 280 caracteres.');
      patch['bio'] = bio || null;
    }
    if (body?.username !== undefined) {
      const username = typeof body.username === 'string' ? body.username.trim() : '';
      if (!USERNAME.test(username)) throw new BadRequestException('O @ precisa ter de 3 a 24 letras, números ou _ (sem espaço nem acento).');
      if (RESERVED.has(username.toLowerCase()) && me.role === 'user') throw new BadRequestException('Esse @ é reservado. Escolha outro.');
      if (username !== me.username) patch['username'] = username;
    }
    if (!Object.keys(patch).length) return this.publicView(me.id);

    const { error } = await this.supabase.db.from('users').update(patch).eq('id', me.id);
    if (error?.code === '23505') throw new ConflictException('Esse @ já está em uso. Escolha outro.');
    if (error) throw new InternalServerErrorException('Não deu para salvar agora.');
    return this.publicView(me.id);
  }

  @Post('auth/logout-all')
  @HttpCode(204)
  async logoutAll(@Req() req: HttpReq, @Res({ passthrough: true }) res: HttpRes): Promise<void> {
    sameOrigin(req);
    const me = await this.me(req);
    const { error } = await this.supabase.db.from('user_sessions').delete().eq('user_id', me.id);
    if (error) throw new InternalServerErrorException('Não deu para encerrar as sessões agora.');
    res.setHeader('Set-Cookie', cookie(SESSION_COOKIE, '', 0));
  }

  /**
   * Exclusão de verdade: apaga o usuário. Pelo banco, isso apaga junto as contas ligadas
   * (Steam/Discord) e as sessões; conteúdo público que a pessoa escreveu fica sem autor.
   */
  @Delete('auth/account')
  @HttpCode(204)
  async remove(@Req() req: HttpReq, @Res({ passthrough: true }) res: HttpRes, @Body() body: { confirm?: unknown }): Promise<void> {
    sameOrigin(req);
    const me = await this.me(req);
    if (typeof body?.confirm !== 'string' || body.confirm.trim().replace(/^@/, '').toLowerCase() !== me.username.toLowerCase()) {
      throw new BadRequestException('Digite o seu @ exatamente para confirmar.');
    }
    const { error } = await this.supabase.db.from('users').delete().eq('id', me.id);
    if (error) throw new InternalServerErrorException('Não deu para excluir agora. Tente de novo ou fale com a gente.');
    res.setHeader('Set-Cookie', cookie(SESSION_COOKIE, '', 0));
  }

  private async me(req: HttpReq): Promise<SessionUser> {
    const user = await this.sessions.user(readCookie(header(req, 'cookie'), SESSION_COOKIE));
    if (!user) throw new UnauthorizedException('Entre com a sua conta.');
    return user;
  }

  private async publicView(id: string) {
    const { data, error } = await this.supabase.db.from('users').select('username, display_name, avatar_url, bio').eq('id', id).single();
    if (error) throw new InternalServerErrorException('Não deu para carregar a conta.');
    return data;
  }
}

function header(req: HttpReq, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

/** Alterações só podem vir do próprio site (contra CSRF; o cookie SameSite=Lax já ajuda). */
function sameOrigin(req: HttpReq): void {
  const origin = header(req, 'origin');
  if (origin && origin.replace(/\/+$/, '') !== webUrl()) throw new ForbiddenException('Origem não permitida.');
  if (!origin && header(req, 'sec-fetch-site') === 'cross-site') throw new ForbiddenException('Origem não permitida.');
}

/** Uma linha: sem caracteres de controle/invisíveis, espaços colapsados. */
function cleanLine(v: unknown): string {
  return typeof v === 'string'
    ? v.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, '').replace(/\s+/g, ' ').trim()
    : '';
}

/** Texto curto: mantém quebras de linha (no máximo 2 seguidas). */
function cleanText(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, '')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
DDHUB_EOF
echo "ok  apps/api/src/auth/account.controller.ts"

cat > 'apps/web/src/app/core/services/account.service.ts' <<'DDHUB_EOF'
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
DDHUB_EOF
echo "ok  apps/web/src/app/core/services/account.service.ts"

cat > 'apps/web/src/app/features/account/user-profile.ts' <<'DDHUB_EOF'
import { Component, computed, inject, input } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, startWith, switchMap } from 'rxjs';

import { AccountService, PublicProfile } from '../../core/services/account.service';
import { AuthService } from '../../core/services/auth.service';

type State = { status: 'loading' } | { status: 'missing' } | { status: 'ok'; profile: PublicProfile };

/** Perfil público: /u/<@> */
@Component({
  selector: 'app-user-profile',
  imports: [DatePipe, RouterLink],
  template: `
    <section class="profile">
      @switch (state().status) {
        @case ('loading') {
          <p class="muted">Carregando perfil…</p>
        }
        @case ('missing') {
          <h1>Perfil não encontrado</h1>
          <p class="muted">Esse &#64; não existe ou a conta foi excluída.</p>
          <a routerLink="/">Voltar para o início</a>
        }
        @case ('ok') {
          @let p = profile()!;
          <header class="card">
            @if (p.avatar_url) {
              <img class="avatar" [src]="p.avatar_url" alt="" width="112" height="112" />
            } @else {
              <span class="avatar avatar--empty" aria-hidden="true">{{ p.display_name.charAt(0) }}</span>
            }
            <div class="who">
              <h1>
                {{ p.display_name }}
                @if (p.staff) {
                  <span class="staff">Equipe DDhub</span>
                }
              </h1>
              <p class="handle">&#64;{{ p.username }}</p>
              <p class="since">No DDhub desde {{ p.created_at | date: "MMMM 'de' y" }}</p>
              @if (p.bio) {
                <p class="bio">{{ p.bio }}</p>
              }
            </div>
            @if (isMe()) {
              <a class="edit" routerLink="/conta">Editar perfil</a>
            }
          </header>
          <p class="muted soon">Em breve: builds, posts no fórum e estatísticas de partidas aparecem aqui.</p>
        }
      }
    </section>
  `,
  styles: `
    .profile { max-width: 860px; margin: 0 auto; padding: 32px 16px 48px; display: flex; flex-direction: column; gap: 16px; }
    .card { display: flex; gap: 20px; align-items: flex-start; padding: 24px; background: var(--surface); border: 1px solid var(--border); position: relative; }
    @media (max-width: 560px) { .card { flex-direction: column; } }
    .avatar { width: 112px; height: 112px; border-radius: 4px; object-fit: cover; flex: none; border: 2px solid var(--accent); }
    .avatar--empty { display: grid; place-items: center; background: var(--surface-sub); color: var(--accent); font-size: 48px; font-weight: 700; text-transform: uppercase; }
    .who { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    h1 { margin: 0; font-family: var(--font-display); color: var(--text-strong); display: flex; align-items: center; gap: 10px; flex-wrap: wrap; overflow-wrap: anywhere; }
    .staff { font-family: var(--font-cond); font-size: 12px; text-transform: uppercase; letter-spacing: .06em; padding: 3px 8px; background: var(--accent); color: var(--bg); }
    .handle { margin: 0; color: var(--accent); font-weight: 600; }
    .since { margin: 0; color: var(--muted); font-size: 14px; }
    .bio { margin: 8px 0 0; white-space: pre-line; color: var(--text); overflow-wrap: anywhere; }
    .edit { position: absolute; top: 20px; right: 20px; font-size: 14px; }
    @media (max-width: 560px) { .edit { position: static; } }
    .muted { color: var(--muted); }
    .soon { font-size: 14px; }
  `,
})
export class UserProfile {
  private readonly accounts = inject(AccountService);
  private readonly auth = inject(AuthService);

  /** Vem da rota /u/:username */
  readonly username = input.required<string>();

  protected readonly state = toSignal(
    toObservable(this.username).pipe(
      switchMap((u) =>
        this.accounts.profile(u).pipe(
          map((profile): State => ({ status: 'ok', profile })),
          catchError(() => of<State>({ status: 'missing' })),
          startWith<State>({ status: 'loading' }),
        ),
      ),
    ),
    { initialValue: { status: 'loading' } as State },
  );

  protected readonly profile = computed(() => {
    const s = this.state();
    return s.status === 'ok' ? s.profile : null;
  });

  protected readonly isMe = computed(() => {
    const me = this.auth.user();
    const p = this.profile();
    return !!me && !!p && me.username.toLowerCase() === p.username.toLowerCase();
  });
}
DDHUB_EOF
echo "ok  apps/web/src/app/features/account/user-profile.ts"

cat > 'apps/web/src/app/features/account/account-page.ts' <<'DDHUB_EOF'
import { Component, computed, effect, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';

import { AccountData, AccountService, apiError } from '../../core/services/account.service';
import { AuthService } from '../../core/services/auth.service';

/** /conta: editar perfil, contas ligadas, sessões, baixar dados e excluir conta (LGPD). */
@Component({
  selector: 'app-account-page',
  imports: [DatePipe, RouterLink],
  templateUrl: './account-page.html',
  styleUrl: './account-page.scss',
})
export class AccountPage {
  protected readonly auth = inject(AuthService);
  private readonly accounts = inject(AccountService);
  private readonly router = inject(Router);

  protected readonly data = signal<AccountData | null>(null);
  protected readonly loadError = signal(false);

  // Formulário do perfil
  protected readonly displayName = signal('');
  protected readonly username = signal('');
  protected readonly bio = signal('');
  protected readonly saving = signal(false);
  protected readonly saveMsg = signal<{ ok: boolean; text: string } | null>(null);

  // Zona de perigo
  protected readonly confirmText = signal('');
  protected readonly busy = signal(false);
  protected readonly dangerMsg = signal<string | null>(null);

  protected readonly dirty = computed(() => {
    const u = this.data()?.user;
    return !!u && (this.displayName() !== u.display_name || this.username() !== u.username || this.bio() !== (u.bio ?? ''));
  });
  protected readonly canDelete = computed(() => {
    const u = this.data()?.user;
    return !!u && this.confirmText().trim().replace(/^@/, '').toLowerCase() === u.username.toLowerCase();
  });
  protected readonly steam = computed(() => this.data()?.identities.find((i) => i.provider === 'steam') ?? null);

  constructor() {
    // Carrega quando souber que tem alguém logado
    effect(() => {
      if (this.auth.user() && !this.data()) void this.load();
    });
  }

  protected loginUrl(): string {
    return this.auth.steamLoginUrl('/conta');
  }

  private async load(): Promise<void> {
    try {
      const d = await this.accounts.account();
      this.data.set(d);
      this.displayName.set(d.user.display_name);
      this.username.set(d.user.username);
      this.bio.set(d.user.bio ?? '');
    } catch {
      this.loadError.set(true);
    }
  }

  protected async save(): Promise<void> {
    const u = this.data()?.user;
    if (!u || this.saving()) return;
    this.saving.set(true);
    this.saveMsg.set(null);
    try {
      await this.accounts.update({ display_name: this.displayName(), username: this.username(), bio: this.bio() });
      this.data.set(null);
      await this.load();
      this.saveMsg.set({ ok: true, text: 'Perfil salvo.' });
    } catch (err) {
      this.saveMsg.set({ ok: false, text: apiError(err) });
    } finally {
      this.saving.set(false);
    }
  }

  protected reset(): void {
    const u = this.data()?.user;
    if (!u) return;
    this.displayName.set(u.display_name);
    this.username.set(u.username);
    this.bio.set(u.bio ?? '');
    this.saveMsg.set(null);
  }

  /** "Baixar meus dados" (LGPD): o mesmo JSON que a API guarda sobre você. */
  protected download(): void {
    const d = this.data();
    if (!d) return;
    const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ddhub-meus-dados-${d.user.username}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  protected async logoutAll(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await this.accounts.logoutAll();
      await this.router.navigateByUrl('/');
    } catch (err) {
      this.dangerMsg.set(apiError(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(): Promise<void> {
    if (!this.canDelete() || this.busy()) return;
    this.busy.set(true);
    this.dangerMsg.set(null);
    try {
      await this.accounts.remove(this.confirmText());
      await this.router.navigateByUrl('/?login=excluida');
    } catch (err) {
      this.dangerMsg.set(apiError(err));
    } finally {
      this.busy.set(false);
    }
  }
}
DDHUB_EOF
echo "ok  apps/web/src/app/features/account/account-page.ts"

cat > 'apps/web/src/app/features/account/account-page.html' <<'DDHUB_EOF'
<section class="account">
  <h1>Minha conta</h1>

  @if (auth.user() === undefined) {
    <p class="muted">Carregando…</p>
  } @else if (!auth.user()) {
    <div class="box">
      <p>Entre com a sua conta Steam para ver e editar o seu perfil.</p>
      <a class="btn" [href]="loginUrl()">Entrar com Steam</a>
    </div>
  } @else if (loadError()) {
    <p class="muted">Não deu para carregar a sua conta agora. Recarregue a página em alguns segundos.</p>
  } @else if (!data()) {
    <p class="muted">Carregando…</p>
  } @else {
    @let d = data()!;

    <!-- Perfil -->
    <div class="box">
      <div class="box__head">
        <h2>Perfil</h2>
        <a [routerLink]="['/u', d.user.username]">Ver perfil público →</a>
      </div>
      <div class="profile">
        @if (d.user.avatar_url) {
          <img class="avatar" [src]="d.user.avatar_url" alt="" width="88" height="88" />
        } @else {
          <span class="avatar avatar--empty" aria-hidden="true">{{ d.user.display_name.charAt(0) }}</span>
        }
        <p class="muted small">A foto vem da sua conta Steam e atualiza sempre que você entra.</p>
      </div>

      <label class="field">
        <span>Nome de exibição</span>
        <input type="text" maxlength="40" [value]="displayName()" (input)="displayName.set($any($event.target).value)" />
        <small>{{ displayName().length }}/40</small>
      </label>

      <label class="field">
        <span>&#64; (endereço do perfil)</span>
        <div class="handle">
          <em>ddhub/u/</em>
          <input type="text" maxlength="24" [value]="username()" (input)="username.set($any($event.target).value)" autocomplete="off" spellcheck="false" />
        </div>
        <small>3 a 24 letras, números ou _ (sem espaço nem acento).</small>
      </label>

      <label class="field">
        <span>Bio</span>
        <textarea rows="3" maxlength="280" [value]="bio()" (input)="bio.set($any($event.target).value)" placeholder="Main de quem? Joga em qual time?"></textarea>
        <small>{{ bio().length }}/280</small>
      </label>

      <div class="actions">
        <button class="btn" type="button" (click)="save()" [disabled]="!dirty() || saving()">{{ saving() ? 'Salvando…' : 'Salvar' }}</button>
        @if (dirty()) {
          <button class="btn btn--ghost" type="button" (click)="reset()">Desfazer</button>
        }
        @if (saveMsg(); as m) {
          <span class="msg" [class.msg--ok]="m.ok" role="status">{{ m.text }}</span>
        }
      </div>
    </div>

    <!-- Contas ligadas -->
    <div class="box">
      <h2>Contas ligadas</h2>
      <ul class="links">
        <li>
          <strong>Steam</strong>
          @if (steam(); as s) {
            <span>{{ s.provider_username || 'conectada' }} · ligada em {{ s.linked_at | date: 'dd/MM/yyyy' }}</span>
            <span class="ok">Conectada</span>
          }
        </li>
        <li>
          <strong>Discord</strong>
          <span class="muted">Login com Discord chega em breve.</span>
        </li>
      </ul>
    </div>

    <!-- Sessões e dados -->
    <div class="box">
      <h2>Segurança e dados</h2>
      <div class="row">
        <div>
          <strong>Aparelhos conectados: {{ d.sessions.length }}</strong>
          <p class="muted small">Cada navegador onde você entrou conta como um. Se entrou num PC que não é seu, saia de todos.</p>
        </div>
        <button class="btn btn--ghost" type="button" (click)="logoutAll()" [disabled]="busy()">Sair de todos</button>
      </div>
      <div class="row">
        <div>
          <strong>Baixar meus dados</strong>
          <p class="muted small">Um arquivo com tudo o que o DDhub guarda sobre a sua conta (LGPD, art. 18).</p>
        </div>
        <button class="btn btn--ghost" type="button" (click)="download()">Baixar (.json)</button>
      </div>
    </div>

    <!-- Excluir -->
    <div class="box box--danger">
      <h2>Excluir conta</h2>
      <p>
        Apaga <strong>na hora e para sempre</strong> o seu perfil, a ligação com a Steam e todas as sessões.
        Não dá para desfazer. Se entrar de novo com a Steam depois, será uma conta nova.
      </p>
      <label class="field">
        <span>Para confirmar, digite o seu &#64;: <strong>{{ d.user.username }}</strong></span>
        <input type="text" [value]="confirmText()" (input)="confirmText.set($any($event.target).value)" autocomplete="off" spellcheck="false" />
      </label>
      <div class="actions">
        <button class="btn btn--danger" type="button" (click)="remove()" [disabled]="!canDelete() || busy()">
          {{ busy() ? 'Excluindo…' : 'Excluir minha conta' }}
        </button>
        @if (dangerMsg(); as m) {
          <span class="msg" role="alert">{{ m }}</span>
        }
      </div>
    </div>
  }
</section>
DDHUB_EOF
echo "ok  apps/web/src/app/features/account/account-page.html"

cat > 'apps/web/src/app/features/account/account-page.scss' <<'DDHUB_EOF'
.account {
  max-width: 760px;
  margin: 0 auto;
  padding: 32px 16px 48px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

h1 {
  margin: 0;
  font-family: var(--font-display);
  color: var(--text-strong);
}

h2 {
  margin: 0 0 12px;
  font-family: var(--font-cond);
  font-size: 18px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-strong);
}

.box {
  padding: 20px;
  background: var(--surface);
  border: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 12px;

  p {
    margin: 0;
  }

  &--danger {
    border-color: var(--live);
  }
}

.box__head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;

  h2 {
    margin: 0;
  }

  a {
    font-size: 14px;
  }
}

.profile {
  display: flex;
  align-items: center;
  gap: 16px;
}

.avatar {
  width: 88px;
  height: 88px;
  border-radius: 4px;
  object-fit: cover;
  border: 2px solid var(--accent);
  flex: none;

  &--empty {
    display: grid;
    place-items: center;
    background: var(--surface-sub);
    color: var(--accent);
    font-size: 36px;
    font-weight: 700;
    text-transform: uppercase;
  }
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;

  > span {
    font-weight: 600;
    color: var(--text-strong);
  }

  small {
    color: var(--muted);
    font-size: 12px;
  }

  input,
  textarea {
    width: 100%;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 2px;
    background: var(--bg);
    color: var(--text-strong);
    font: inherit;
    resize: vertical;

    &:focus {
      outline: 2px solid var(--accent);
      outline-offset: 1px;
    }
  }
}

.handle {
  display: flex;
  align-items: center;
  border: 1px solid var(--border);
  background: var(--bg);

  em {
    padding: 0 0 0 12px;
    font-style: normal;
    color: var(--muted);
  }

  input {
    border: 0;
    padding-left: 2px;
  }
}

.actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.btn {
  display: inline-flex;
  align-items: center;
  height: 40px;
  padding: 0 16px;
  border: 1px solid var(--accent);
  border-radius: 2px;
  background: var(--accent);
  color: var(--bg);
  font-family: var(--font-cond);
  font-size: 15px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  text-decoration: none;
  cursor: pointer;
  white-space: nowrap;
  align-self: flex-start;

  &:disabled {
    opacity: 0.45;
    cursor: default;
  }

  &--ghost {
    background: none;
    color: var(--text-strong);
    border-color: var(--border);

    &:hover:not(:disabled) {
      border-color: var(--accent);
    }
  }

  &--danger {
    background: var(--live);
    border-color: var(--live);
    color: #fff;
  }
}

.msg {
  font-size: 14px;
  color: var(--live);

  &--ok {
    color: var(--win);
  }
}

.links {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;

  li {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    padding: 10px 12px;
    background: var(--bg);
    border: 1px solid var(--border);
  }

  strong {
    min-width: 70px;
  }

  .ok {
    margin-left: auto;
    font-size: 13px;
    color: var(--win);
  }
}

.row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;

  & + .row {
    padding-top: 12px;
    border-top: 1px solid var(--border);
  }

  @media (max-width: 560px) {
    flex-direction: column;
    align-items: flex-start;
  }
}

.muted {
  color: var(--muted);
}

.small {
  font-size: 13px;
}
DDHUB_EOF
echo "ok  apps/web/src/app/features/account/account-page.scss"

node - <<'JS'
const fs = require('fs');
let fail = 0;
function edit(p, find, repl, check) {
  let s = fs.readFileSync(p, 'utf8');
  if (s.includes(check)) return console.log('já estava  ' + p);
  if (!s.includes(find)) { console.error('NÃO ACHEI o trecho em ' + p + ': ' + find.slice(0, 50)); fail = 1; return; }
  fs.writeFileSync(p, s.replace(find, repl));
  console.log('editado  ' + p);
}
const api = 'apps/api/src/auth/auth.module.ts';
edit(api, "import { AuthController } from './auth.controller.js';",
  "import { AccountController } from './account.controller.js';\nimport { AuthController } from './auth.controller.js';", 'AccountController }');
edit(api, 'controllers: [AuthController],', 'controllers: [AuthController, AccountController],', 'AuthController, AccountController]');

edit('apps/web/src/app/app.routes.ts',
  "  {\n    path: 'privacidade',",
  "  {\n    path: 'conta',\n    title: 'Minha conta · DDhub',\n    loadComponent: () => import('./features/account/account-page').then((m) => m.AccountPage),\n  },\n  {\n    path: 'u/:username',\n    title: 'Perfil · DDhub',\n    loadComponent: () => import('./features/account/user-profile').then((m) => m.UserProfile),\n  },\n  {\n    path: 'privacidade',",
  "path: 'u/:username'");

const menu = 'apps/web/src/app/shared/user-menu/user-menu.ts';
edit(menu, "import { Router } from '@angular/router';", "import { Router, RouterLink } from '@angular/router';", 'Router, RouterLink }');
edit(menu, "  suspensa: 'Esta conta está suspensa.',", "  suspensa: 'Esta conta está suspensa.',\n  excluida: 'Sua conta foi excluída. Seus dados foram apagados.',", 'excluida:');
edit(menu, "  selector: 'app-user-menu',\n  template:", "  selector: 'app-user-menu',\n  imports: [RouterLink],\n  template:", 'imports: [RouterLink]');
edit(menu,
  `                <button type="button" role="menuitem" class="account__item" (click)="logout()">Sair</button>`,
  `                <a role="menuitem" class="account__item" [routerLink]="['/u', u.username]" (click)="open.set(false)">Meu perfil</a>
                <a role="menuitem" class="account__item" routerLink="/conta" (click)="open.set(false)">Minha conta</a>
                <button type="button" role="menuitem" class="account__item" (click)="logout()">Sair</button>`,
  'Minha conta</a>');
edit(menu, "    .account__item {\n      min-height: 40px;", "    .account__item {\n      display: flex;\n      align-items: center;\n      text-decoration: none;\n      min-height: 40px;", "text-decoration: none;\n      min-height: 40px;");
// Toast de sucesso (conta excluída) com borda verde
edit(menu, "      this.message.set(LOGIN_MESSAGES[code]);", "      this.message.set(LOGIN_MESSAGES[code]);\n      this.ok.set(code === 'excluida');", "this.ok.set(code");
edit(menu, "  protected readonly message = signal<string | null>(null);", "  protected readonly message = signal<string | null>(null);\n  protected readonly ok = signal(false);", 'readonly ok = signal');
edit(menu, `      <p class="toast" role="status">{{ message() }}</p>`, `      <p class="toast" [class.toast--ok]="ok()" role="status">{{ message() }}</p>`, 'toast--ok');
edit(menu, "      border-left: 3px solid var(--live);\n      font-size: 13px;\n      color: var(--text);\n    }", "      border-left: 3px solid var(--live);\n      font-size: 13px;\n      color: var(--text);\n    }\n    .toast--ok { border-left-color: var(--win); }", '.toast--ok {');

edit('apps/web/src/app/features/legal/legal-docs.ts',
  '- **Excluir a conta:** por enquanto, peça por **${CONTACT_EMAIL}** e apagamos seus dados em até 15 dias. Um botão de exclusão vai entrar na página da conta.',
  '- **Seu perfil e seus dados:** em **Minha conta** você muda o nome de exibição, o @ e a bio, sai de todos os aparelhos e baixa um arquivo com tudo o que guardamos sobre a sua conta.\n- **Excluir a conta:** em **Minha conta → Excluir conta**. A exclusão é imediata: apagamos o perfil, a ligação com a Steam e as sessões. Se preferir, peça por **${CONTACT_EMAIL}**.',
  'Minha conta → Excluir conta');
process.exitCode = fail;
JS

echo
echo "Conferência (esperado: 2 1 2 1 1):"
grep -c "AccountController" apps/api/src/auth/auth.module.ts
grep -c "path: 'u/:username'" apps/web/src/app/app.routes.ts
grep -c "Minha conta</a>\|Meu perfil</a>" apps/web/src/app/shared/user-menu/user-menu.ts
grep -c "Minha conta → Excluir conta" apps/web/src/app/features/legal/legal-docs.ts
grep -c "@Delete('auth/account')" apps/api/src/auth/account.controller.ts
