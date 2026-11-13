import { Controller, Get } from '@nestjs/common';

import { LiveService } from './live.service.js';
import type { LiveSnapshot } from './live.service.js';

@Controller('live')
export class LiveController {
  constructor(private readonly live: LiveService) {}

  /** Criadores ao vivo em Deadlock agora (atualizado a cada 2 minutos). */
  @Get()
  get(): LiveSnapshot {
    return this.live.current;
  }
}