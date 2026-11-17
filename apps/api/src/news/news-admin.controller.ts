import { Controller, Headers, HttpCode, Post, Query } from '@nestjs/common';

import { assertAdminToken } from '../cache/admin-token.js';
import { MemoryCache } from '../cache/memory-cache.service.js';
import { NewsSyncService } from './news-sync.service.js';
import { TranslatorService } from './translator.service.js';

/**
 * Comandos de admin das notícias (cabeçalho x-admin-token = ADMIN_SYNC_TOKEN).
 *
 *   Buscar anúncios na Steam agora:
 *     curl -X POST https://ddhub-api.onrender.com/admin/news/sync -H "x-admin-token: SEU_TOKEN"
 *   Traduzir até 10 anúncios pendentes:
 *     curl -X POST "https://ddhub-api.onrender.com/admin/news/translate?max=10" -H "x-admin-token: SEU_TOKEN"
 */
@Controller('admin/news')
export class NewsAdminController {
  constructor(
    private readonly sync: NewsSyncService,
    private readonly translator: TranslatorService,
    private readonly cache: MemoryCache,
  ) {}

  @Post('sync')
  @HttpCode(200)
  async runSync(@Headers('x-admin-token') token?: string) {
    assertAdminToken(token);
    return { imported: await this.sync.sync() };
  }

  @Post('translate')
  @HttpCode(200)
  async translate(@Headers('x-admin-token') token?: string, @Query('max') max?: string) {
    assertAdminToken(token);
    const n = Math.min(Math.max(Number(max) || 5, 1), 20);
    const translated = await this.translator.translatePending(n);
    if (translated) this.cache.clear();
    return { translated };
  }
}