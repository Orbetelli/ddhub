import { Module } from '@nestjs/common';

import { BuildsController } from './builds.controller.js';

/** SessionService vem do AuthModule (global). */
@Module({ controllers: [BuildsController] })
export class BuildsModule {}
