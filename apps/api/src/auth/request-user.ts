import { ForbiddenException, UnauthorizedException } from '@nestjs/common';

import { SESSION_COOKIE, SessionService, readCookie, webUrl } from './session.service.js';
import type { SessionUser } from './session.service.js';

/** O mínimo do Request que usamos (sem depender dos tipos do Express). */
export interface HttpReq {
  headers: Record<string, string | string[] | undefined>;
}

export function header(req: HttpReq, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

/** Quem está logado (ou null). */
export function optionalUser(sessions: SessionService, req: HttpReq): Promise<SessionUser | null> {
  return sessions.user(readCookie(header(req, 'cookie'), SESSION_COOKIE));
}

/** Quem está logado; se ninguém, 401. */
export async function requireUser(sessions: SessionService, req: HttpReq): Promise<SessionUser> {
  const user = await optionalUser(sessions, req);
  if (!user) throw new UnauthorizedException('Entre com a sua conta.');
  return user;
}

/** Alterações só podem vir do próprio site (contra CSRF; o cookie SameSite=Lax já ajuda). */
export function assertSameOrigin(req: HttpReq): void {
  const origin = header(req, 'origin');
  if (origin && origin.replace(/\/+$/, '') !== webUrl()) throw new ForbiddenException('Origem não permitida.');
  if (!origin && header(req, 'sec-fetch-site') === 'cross-site') throw new ForbiddenException('Origem não permitida.');
}

/** Uma linha de texto: sem caracteres de controle/invisíveis, espaços colapsados. */
export function cleanLine(v: unknown): string {
  return typeof v === 'string' ? v.replace(INVISIBLE, '').replace(/\s+/g, ' ').trim() : '';
}

/** Texto com parágrafos: mantém quebras de linha (no máximo 2 seguidas). */
export function cleanText(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v
    .replace(/\r\n?/g, '\n')
    .replace(INVISIBLE_KEEP_NL, '')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g;
const INVISIBLE_KEEP_NL = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g;
