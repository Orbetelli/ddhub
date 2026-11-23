import { Module } from '@nestjs/common';

import { DailyController } from './daily.controller.js';
import { GameDataModule } from '../game-data/game-data.module.js';

@Module({ imports: [GameDataModule], controllers: [DailyController] })
export class DailyModule {}
