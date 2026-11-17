import { Module } from '@nestjs/common';

import { NewsController } from './news.controller.js';
import { NewsAdminController } from './news-admin.controller.js';
import { NewsSyncService } from './news-sync.service.js';
import { TranslatorService } from './translator.service.js';

@Module({
  controllers: [NewsController, NewsAdminController],
  providers: [NewsSyncService, TranslatorService],
})
export class NewsModule {}