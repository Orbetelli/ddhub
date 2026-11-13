import { Module } from '@nestjs/common';
import { LearnController } from './learn.controller.js';

@Module({
  controllers: [LearnController],
})
export class LearnModule {}