import { Module } from '@nestjs/common';

import { DeadlockApiClient } from './deadlock-api.client.js';
import { GameSyncService } from './game-sync.service.js';
import { GameDataController } from './game-data.controller.js';
import { AssetRefsController } from './asset-refs.controller.js';
import { ItemsController } from './items.controller.js';
import { MapController } from './map.controller.js';
import { HeroStatsController } from './hero-stats.controller.js';

@Module({
  controllers: [GameDataController, AssetRefsController, ItemsController, MapController, HeroStatsController],
  // MapController também como provider: o jogo diário (modo Mapa) usa os mesmos dados
  providers: [DeadlockApiClient, GameSyncService, MapController],
  exports: [GameSyncService, MapController],
})
export class GameDataModule {}