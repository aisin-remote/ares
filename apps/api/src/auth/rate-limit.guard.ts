import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';

const RATE_LIMIT = 'rateLimit';

interface RateLimitOptions {
  limit: number;
  windowSeconds: number;
  /** Batas semua identitas dari satu IP; menahan rotasi nama akun palsu. */
  ipLimit?: number;
  /** Kolom body ikut kunci agar satu kantor NAT tidak saling mengunci akun berbeda. */
  identityField?: 'npk' | 'deviceCode' | 'email' | 'challengeId' | 'mfaToken';
}

export const LimitRequests = (options: RateLimitOptions) => SetMetadata(RATE_LIMIT, options);

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Pagar murah sebelum bcrypt untuk menahan brute force dan CPU exhaustion.
 * Berlaku per proses; reverse proxy produksi tetap wajib punya limit global.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const options = this.reflector.getAllAndOverride<RateLimitOptions | undefined>(RATE_LIMIT, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!options) return true;

    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const now = Date.now();
    if (this.buckets.size > 10_000) {
      for (const [key, bucket] of this.buckets) if (bucket.resetAt <= now) this.buckets.delete(key);
    }

    const identity = options.identityField
      ? String((req.body as Record<string, unknown> | undefined)?.[options.identityField] ?? '')
          .trim()
          .toLowerCase()
      : '';
    const routeKey = `${req.ip}|${req.method}|${req.path}`;
    const ipBucket = this.consume(routeKey, options.windowSeconds, now);
    const bucket = identity
      ? this.consume(`${routeKey}|${identity}`, options.windowSeconds, now)
      : ipBucket;

    const remaining = Math.max(0, options.limit - bucket.count);
    res.setHeader('X-RateLimit-Limit', String(options.limit));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
    const ipLimit = options.ipLimit ?? options.limit * 10;
    if (bucket.count <= options.limit && ipBucket.count <= ipLimit) return true;

    const retryAfter = Math.max(
      1,
      Math.ceil((Math.max(bucket.resetAt, ipBucket.resetAt) - now) / 1000),
    );
    res.setHeader('Retry-After', String(retryAfter));
    throw new HttpException(
      {
        statusCode: 429,
        error: 'TooManyRequests',
        message: 'Terlalu banyak percobaan. Coba lagi beberapa saat.',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private consume(rawKey: string, windowSeconds: number, now: number): Bucket {
    const key = createHash('sha256').update(rawKey).digest('base64url');
    const existing = this.buckets.get(key);
    const bucket =
      !existing || existing.resetAt <= now
        ? { count: 0, resetAt: now + windowSeconds * 1000 }
        : existing;
    bucket.count += 1;
    this.buckets.set(key, bucket);
    return bucket;
  }
}
