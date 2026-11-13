import { Module } from '@nestjs/common';

import { CreatorsController } from './creators.controller.js';

@Module({
  controllers: [CreatorsController],
})
export class CreatorsModule {}