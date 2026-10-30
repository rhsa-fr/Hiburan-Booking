import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadConfig } from './core/config';

async function bootstrap(): Promise<void> {
  const cfg = loadConfig();
  // rawBody is required so the PJP webhook HMAC can be verified over the exact
  // bytes received (see libs/modules/payment handleWebhook).
  const app = await NestFactory.create(AppModule, { bufferLogs: false, rawBody: true });
  app.enableShutdownHooks();
  // Panel admin berjalan di origin berbeda (localhost:3002). Daftar origin
  // eksplisit — bukan wildcard — karena API memegang token Bearer.
  const allowedOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:3002')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'Accept', 'X-Request-Id'],
    maxAge: 600
  });
  // Behind Railway/reverse proxies `@Ip()` must read X-Forwarded-For, otherwise
  // every client shares one IP and the per-IP limiter blocks everyone.
  app.getHttpAdapter().getInstance().set('trust proxy', cfg.TRUST_PROXY);
  app.setGlobalPrefix('v1');
  await app.listen(cfg.PORT);
  // eslint-disable-next-line no-console
  console.log(`tarlink api listening on :${cfg.PORT}`);
}

void bootstrap();
