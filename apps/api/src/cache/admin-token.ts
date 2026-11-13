import { ForbiddenException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';

/**
 * Confere o cabeçalho x-admin-token contra ADMIN_SYNC_TOKEN do .env.
 * Sem token configurado (ou curto demais), as rotas de admin ficam desligadas.
 */
export function assertAdminToken(token?: string): void {
  const expected = process.env['ADMIN_SYNC_TOKEN'];
  if (!expected || expected.length < 32 || !token) throw new ForbiddenException();
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ForbiddenException();
}