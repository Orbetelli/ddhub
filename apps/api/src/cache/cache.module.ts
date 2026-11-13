import { Global, Module } from '@nestjs/common';

import { MemoryCache } from './memory-cache.service.js';
import { CacheController } from './cache.controller.js';

@Global()
@Module({
  controllers: [CacheController],
  providers: [MemoryCache],
  exports: [MemoryCache],
})
export class CacheModule {}