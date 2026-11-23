import { Global, Module } from '@nestjs/common';

import { TwitchClient } from './twitch.client.js';
import { KickClient } from './kick.client.js';
import { LiveService } from './live.service.js';
import { LiveController } from './live.controller.js';

/** Global para o CreatorsController usar as fotos da Twitch. */
@Global()
@Module({
  controllers: [LiveController],
  providers: [TwitchClient, KickClient, LiveService],
  exports: [LiveService],
})
export class TwitchModule {}