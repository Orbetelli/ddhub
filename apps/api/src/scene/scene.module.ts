import { Module } from '@nestjs/common';

import { SceneController } from './scene.controller.js';
import { TournamentsController } from './tournaments.controller.js';

@Module({
  controllers: [SceneController, TournamentsController],
})
export class SceneModule {}