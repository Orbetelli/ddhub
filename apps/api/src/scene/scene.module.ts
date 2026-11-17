import { Module } from '@nestjs/common';

import { SceneController } from './scene.controller.js';

@Module({
  controllers: [SceneController],
})
export class SceneModule {}