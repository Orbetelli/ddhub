import { Global, Module } from '@nestjs/common';

import { AuthController } from './auth.controller.js';
import { SessionService } from './session.service.js';
import { SteamOpenIdService } from './steam-openid.service.js';
import { UsersService } from './users.service.js';

/** Global: builds e fórum vão usar o SessionService para saber quem está logado. */
@Global()
@Module({
  controllers: [AuthController],
  providers: [SessionService, SteamOpenIdService, UsersService],
  exports: [SessionService],
})
export class AuthModule {}
