import { NestFactory } from '@nestjs/core';
import { AppModule, ObserveInstrument } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    instrument: ObserveInstrument,
  });

  // WEB_ORIGIN aceita vários endereços separados por vírgula:
  //   WEB_ORIGIN=http://localhost:4200,https://ddhub-br.vercel.app
  const origins = (process.env.WEB_ORIGIN ?? 'http://localhost:4200')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);
  app.enableCors({ origin: origins });

  // O Render define a porta pela variável PORT
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
