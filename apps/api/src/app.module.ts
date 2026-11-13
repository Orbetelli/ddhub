import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { createObserveModule } from '@nestjs/observe';

import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { SupabaseModule } from './supabase/supabase.module.js';
import { CacheModule } from './cache/cache.module.js';
import { GameDataModule } from './game-data/game-data.module.js';
import { LearnModule } from './learn/learn.module.js';
import { CreatorsModule } from './creators/creators.module.js';
import { TwitchModule } from './twitch/twitch.module.js';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

@Module({
  imports: [
    // Precisa vir primeiro: carrega o .env antes dos outros módulos lerem process.env
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),

    ObserveModule.forRoot({
      appKey: process.env.OBSERVE_APP_KEY ?? 'YOUR_APP_KEY',
      appSecret: process.env.OBSERVE_APP_SECRET ?? 'YOUR_APP_SECRET',
      serviceId: 'api',
    }),

    SupabaseModule,
    CacheModule,
    GameDataModule,
    LearnModule,
    TwitchModule,
    CreatorsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
