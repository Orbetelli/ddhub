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
