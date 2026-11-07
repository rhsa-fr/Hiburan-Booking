import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { NestFactory } from '@nestjs/core';
import { attachChatGateway, ChatService } from '@tarlink/modules/chat';
import { getPool } from '@tarlink/core/db';
import { AppModule } from './app.module';
import { loadConfig } from './core/config';
import { installSessionChecker } from './core/session-checker';

/** Request augmented with the correlation id reported by the error envelope. */
interface RequestWithCorrelationId extends IncomingMessage {
  id?: string;
}

/**
 * A client correlation id must be a single, short, log-safe token. Duplicated
 * headers arrive as an array, and blank or unbounded values would let a caller
 * forge log lines, so anything outside this shape is replaced by a fresh UUID.
 */
const CORRELATION_ID_PATTERN = /^[\w.-]{1,64}$/;

async function bootstrap(): Promise<void> {
  const cfg = loadConfig();
  // A valid signature is not enough: revoked sessions must fail immediately.
  installSessionChecker();
  // rawBody is required so the PJP webhook HMAC can be verified over the exact
  // bytes received (see libs/modules/payment handleWebhook).
  const app = await NestFactory.create(AppModule, { bufferLogs: false, rawBody: true });
  // Nothing else writes `req.id`, so the error envelope always reported
  // `request_id: undefined`. Honour the client header only when it is a single
  // valid token, otherwise mint one. Registered before the routes are mapped by
  // listen().
  app.use((req: RequestWithCorrelationId, _res: ServerResponse, next: () => void) => {
    const header = req.headers['x-request-id'];
    req.id =
      typeof header === 'string' && CORRELATION_ID_PATTERN.test(header)
        ? header
        : randomUUID();
    next();
  });
  app.enableShutdownHooks();
  // Panel admin berjalan di origin berbeda (localhost:3002). Daftar origin
  // eksplisit — bukan wildcard — karena API memegang token Bearer.
  const allowedOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:3002')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({
    origin: allowedOrigins,
    // The admin panel sends/receives the HttpOnly refresh cookie, so the
    // browser must be allowed to include credentials. Origins stay explicit.
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'Accept', 'X-Request-Id'],
    maxAge: 600
  });
  // Behind Railway/reverse proxies `@Ip()` must read X-Forwarded-For, otherwise
  // every client shares one IP and the per-IP limiter blocks everyone.
  app.getHttpAdapter().getInstance().set('trust proxy', cfg.TRUST_PROXY);
  app.setGlobalPrefix('v1');
  await app.listen(cfg.PORT);
  // Chat is a WebSocket upgrade on the same HTTP server (ADR 0011). It is
  // attached after listen because the underlying server only exists then.
  attachChatGateway(app.getHttpServer() as Server, {
    service: app.get(ChatService),
    pool: getPool(),
    jwtSecret: cfg.JWT_SECRET,
    allowedOrigins
  });
  // eslint-disable-next-line no-console
  console.log(`tarlink api listening on :${cfg.PORT}`);
}

void bootstrap();
