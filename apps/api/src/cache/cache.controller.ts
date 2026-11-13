import { Controller, Headers, HttpCode, Post } from '@nestjs/common';

import { MemoryCache } from './memory-cache.service.js';
import { assertAdminToken } from './admin-token.js';

@Controller('admin/cache')
export class CacheController {
  constructor(private readonly cache: MemoryCache) {}

  /**
   * Limpa o cache da API (chamado pelo "npm run content:sync").
   *   curl -X POST http://localhost:3000/admin/cache/clear -H "x-admin-token: SEU_TOKEN"
   */
  @Post('clear')
  @HttpCode(200)
  clear(@Headers('x-admin-token') token?: string) {
    assertAdminToken(token);
    return { cleared: this.cache.clear() };
  }
}