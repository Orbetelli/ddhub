import { Controller, Get, Query } from '@nestjs/common';

import { VideosService } from './videos.service.js';
import type { Video } from './videos.service.js';

/** GET /videos?limit=12&creator=slug — últimos vídeos de Deadlock dos criadores BR. */
@Controller('videos')
export class VideosController {
  constructor(private readonly videos: VideosService) {}

  @Get()
  list(@Query('limit') limit?: string, @Query('creator') creator?: string): { updated_at: string | null; videos: Video[] } {
    const max = Math.min(Math.max(Number(limit) || 24, 1), 60);
    const { updated_at, videos } = this.videos.current;
    const list = creator ? videos.filter((v) => v.creator.slug === creator) : videos;
    return { updated_at, videos: list.slice(0, max) };
  }
}
