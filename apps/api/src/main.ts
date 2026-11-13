import { NestFactory } from '@nestjs/core';
import { AppModule, ObserveInstrument } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    instrument: ObserveInstrument,
  });

  // Libera o Angular (localhost:4200) a chamar a API
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:4200' });

  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();