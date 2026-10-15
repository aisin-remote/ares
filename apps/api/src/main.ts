import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { json, urlencoded, type NextFunction, type Request, type Response } from 'express';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, { bufferLogs: false, bodyParser: false });

  const express = app.getHttpAdapter().getInstance();
  express.disable('x-powered-by');
  const proxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 0);
  if (proxyHops > 0) express.set('trust proxy', proxyHops);
  const bodyLimit = process.env.API_BODY_LIMIT ?? '256kb';
  app.use(json({ limit: bodyLimit }));
  app.use(urlencoded({ extended: false, limit: bodyLimit }));
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    if (_req.path.startsWith('/auth/')) res.setHeader('Cache-Control', 'no-store');
    if (process.env.NODE_ENV === 'production') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });

  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableCors({
    origin: (process.env.WEB_ORIGIN ?? 'http://127.0.0.1:3000').split(',').map((v) => v.trim()),
    credentials: false,
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    maxAge: 600,
  });

  // SIGTERM dari Docker/systemd harus menutup koneksi DB, Redis, MQTT dengan
  // rapi. Tanpa ini, deploy ulang bisa memutus scan yang sedang diproses.
  app.enableShutdownHooks();

  const port = Number(process.env.API_PORT ?? 3001);
  const host = process.env.API_HOST ?? '127.0.0.1';
  await app.listen(port, host);

  logger.log(`API siap di http://${host}:${port}`);
  logger.log(`SSE  : GET /realtime/line:DC-01`);
  logger.log(`Health: GET /health/ready`);
}

void bootstrap();
