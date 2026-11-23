import { Controller, ForbiddenException, Get, HttpCode, Logger, Post, Query, Req, Res } from '@nestjs/common';
import { randomBytes, timingSafeEqual } from 'node:crypto';

import { SteamOpenIdService } from './steam-openid.service.js';
import { BannedError, UsersService } from './users.service.js';
import {
  SESSION_COOKIE,
  SESSION_DAYS,
  STATE_COOKIE,
  SessionService,
  cookie,
  readCookie,
  webUrl,
} from './session.service.js';
import type { SessionUser } from './session.service.js';

/** O mínimo de Request/Response que usamos (sem depender dos tipos do Express). */
interface HttpReq {
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, unknown>;
  socket?: { remoteAddress?: string };
}
interface HttpRes {
  setHeader(name: string, value: string | string[]): unknown;
  redirect(status: number, url: string): unknown;
}

const STATE_MINUTES = 10;
/** Tentativas de login por IP a cada 10 min (contra abuso). */
const RATE_LIMIT = 30;

/**
 * Login. O site chama estas rotas pelo próprio endereço (ddhub-br.vercel.app/api/...),
 * via proxy da Vercel: assim o cookie de sessão é do site, não de terceiros.
 *
 *  GET  /auth/steam?next=/caminho   → manda para a Steam
 *  GET  /auth/steam/callback        → volta da Steam, confere, cria a sessão
 *  GET  /auth/me                    → quem está logado (ou null)
 *  POST /auth/logout                → encerra a sessão
 */
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);
  private readonly attempts = new Map<string, { count: number; since: number }>();

  constructor(
    private readonly steam: SteamOpenIdService,
    private readonly sessions: SessionService,
    private readonly users: UsersService,
  ) {}

  @Get('steam')
  steamLogin(@Req() req: HttpReq, @Res() res: HttpRes, @Query('next') next?: string) {
    if (!this.allow(req)) return res.redirect(302, `${webUrl()}/?login=limite`);
    // "state" aleatório: amarra a volta da Steam a ESTE navegador (contra login forjado)
    const state = randomBytes(24).toString('base64url');
    const safeNext = safePath(next);
    res.setHeader('Set-Cookie', cookie(STATE_COOKIE, `${state}|${safeNext}`, STATE_MINUTES * 60, '/api/auth'));
    res.setHeader('Cache-Control', 'no-store');
    return res.redirect(302, this.steam.loginUrl(this.returnTo(state), webUrl()));
  }

  @Get('steam/callback')
  async steamCallback(@Req() req: HttpReq, @Res() res: HttpRes) {
    const fail = (reason: string, code = 'erro') => {
      this.logger.warn(`Login Steam recusado: ${reason}`);
      res.setHeader('Set-Cookie', cookie(STATE_COOKIE, '', 0, '/api/auth'));
      return res.redirect(302, `${webUrl()}/?login=${code}`);
    };
    if (!this.allow(req)) return fail('limite de tentativas', 'limite');

    const saved = readCookie(header(req, 'cookie'), STATE_COOKIE) ?? '';
    const [savedState, savedNext] = saved.split('|');
    const state = typeof req.query['state'] === 'string' ? req.query['state'] : '';
    if (!savedState || !sameString(savedState, state)) return fail('state ausente ou diferente');

    let steamId: string;
    try {
      steamId = await this.steam.verify(req.query, this.returnTo(state));
    } catch (err) {
      return fail(err instanceof Error ? err.message : 'verificação falhou');
    }

    try {
      const profile = await this.steam.profile(steamId);
      const userId = await this.users.findOrCreate({ provider: 'steam', id: steamId, name: profile.name, avatar: profile.avatar });
      const token = await this.sessions.create(userId, 'steam');
      res.setHeader('Set-Cookie', [
        cookie(SESSION_COOKIE, token, SESSION_DAYS * 24 * 60 * 60),
        cookie(STATE_COOKIE, '', 0, '/api/auth'),
      ]);
      res.setHeader('Cache-Control', 'no-store');
      return res.redirect(302, `${webUrl()}${safePath(savedNext)}`);
    } catch (err) {
      if (err instanceof BannedError) return fail('conta suspensa', 'suspensa');
      return fail(err instanceof Error ? err.message : 'erro ao criar sessão');
    }
  }

  @Get('me')
  async me(@Req() req: HttpReq, @Res({ passthrough: true }) res: HttpRes): Promise<{ user: SessionUser | null }> {
    res.setHeader('Cache-Control', 'no-store');
    const user = await this.sessions.user(readCookie(header(req, 'cookie'), SESSION_COOKIE));
    return { user };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: HttpReq, @Res({ passthrough: true }) res: HttpRes): Promise<void> {
    // Só aceita pedido vindo do próprio site (contra CSRF)
    const origin = header(req, 'origin');
    if (origin && origin.replace(/\/+$/, '') !== webUrl()) throw new ForbiddenException('Origem não permitida.');
    await this.sessions.destroy(readCookie(header(req, 'cookie'), SESSION_COOKIE));
    res.setHeader('Set-Cookie', cookie(SESSION_COOKIE, '', 0));
  }

  private returnTo(state: string): string {
    return `${webUrl()}/api/auth/steam/callback?state=${encodeURIComponent(state)}`;
  }

  private allow(req: HttpReq): boolean {
    const ip = (header(req, 'x-forwarded-for') ?? req.socket?.remoteAddress ?? '?').split(',')[0].trim();
    const now = Date.now();
    const a = this.attempts.get(ip);
    if (!a || now - a.since > 10 * 60 * 1000) {
      this.attempts.set(ip, { count: 1, since: now });
      if (this.attempts.size > 5000) this.attempts.clear();
      return true;
    }
    a.count++;
    return a.count <= RATE_LIMIT;
  }
}

function header(req: HttpReq, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

/** Só caminhos internos ("/torneios"), nunca outro site ("//x.com", "https://..."). */
function safePath(p: unknown): string {
  return typeof p === 'string' && /^\/(?![/\\])[\w\-./?=&%#]*$/.test(p) && p.length <= 200 ? p : '/';
}

function sameString(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
