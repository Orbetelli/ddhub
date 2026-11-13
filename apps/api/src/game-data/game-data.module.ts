import { Module } from '@nestjs/common';

import { DeadlockApiClient } from './deadlock-api.client.js';
import { GameSyncService } from './game-sync.service.js';
import { GameDataController } from './game-data.controller.js';

@Module({
  controllers: [GameDataController],
  providers: [DeadlockApiClient, GameSyncService],
  exports: [GameSyncService],
})
export class GameDataModule {}
