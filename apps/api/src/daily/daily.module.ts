import { Module } from '@nestjs/common';

import { DailyController } from './daily.controller.js';

@Module({ controllers: [DailyController] })
export class DailyModule {}
