import { Module } from '@nestjs/common';

import { NewsController } from './news.controller.js';
import { NewsSyncService } from './news-sync.service.js';

@Module({
  controllers: [NewsController],
  providers: [NewsSyncService],
})
export class NewsModule {}