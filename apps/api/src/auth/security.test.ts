import { describe, expect, it, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Request, Response } from 'express';
import { loginSchema } from '@ares/contracts';
import { loadEnv } from '../config/env';
import { PermissionsGuard } from './permissions.guard';
import { RateLimitGuard } from './rate-limit.guard';
import { IS_PUBLIC } from './jwt-auth.guard';

function context(body: Record<string, unknown> = {}): ExecutionContext {
  const headers = new Map<string, string>();
  const req = { ip: '203.0.113.10', method: 'POST', path: '/auth/login', body } as Request;
  const res = { setHeader: (key: string, value: string) => headers.set(key, value) } as unknown as Response;
  return {
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res, getNext: () => undefined }),
  } as unknown as ExecutionContext;
}

describe('pagar keamanan', () => {
  it('menolak endpoint yang lupa diberi kebijakan akses', async () => {
    const reflector = {
      getAllAndOverride: vi.fn((key: string) => key === IS_PUBLIC ? false : undefined),
    };
    const guard = new PermissionsGuard(reflector as never, {} as never);
    await expect(guard.canActivate(context())).rejects.toThrow('Endpoint belum memiliki kebijakan akses');
  });

  it('membatasi login per identitas sebelum bcrypt dijalankan', () => {
    const reflector = { getAllAndOverride: vi.fn(() => ({ limit: 2, ipLimit: 10, windowSeconds: 60, identityField: 'npk' })) };
    const guard = new RateLimitGuard(reflector as never);
    expect(guard.canActivate(context({ npk: 'ADMIN' }))).toBe(true);
    expect(guard.canActivate(context({ npk: 'ADMIN' }))).toBe(true);
    expect(() => guard.canActivate(context({ npk: 'ADMIN' }))).toThrow(HttpException);
  });

  it('menolak password yang melebihi batas 72 byte bcrypt', () => {
    expect(loginSchema.safeParse({ npk: 'A', password: 'é'.repeat(40) }).success).toBe(false);
  });

  it('menolak secret lemah dan origin HTTP pada produksi', () => {
    expect(() => loadEnv({
      NODE_ENV: 'production', DATABASE_URL: 'mysql://db', REDIS_URL: 'redis://cache',
      JWT_SECRET: 'terlalu-pendek', WEB_ORIGIN: 'http://ares.example.com',
    })).toThrow('Konfigurasi environment tidak valid');
  });

  it('menolak autofill OTP demo pada produksi', () => {
    expect(() => loadEnv({
      NODE_ENV: 'production', DATABASE_URL: 'mysql://db', REDIS_URL: 'redis://cache',
      JWT_SECRET: 'Q2x1a0dFc2VyYUJ1a2FuU2VjcmV0UHJvZHVrc2k2NFJhbmRvbQ==',
      WEB_ORIGIN: 'https://ares.example.com', TRUST_PROXY_HOPS: '1',
      SMTP_HOST: 'smtp.example.com', DEMO_OTP_AUTOFILL: 'true',
    })).toThrow('DEMO_OTP_AUTOFILL tidak boleh aktif di produksi');
  });

  it('menerima konfigurasi produksi dengan secret acak dan HTTPS', () => {
    const env = loadEnv({
      NODE_ENV: 'production', DATABASE_URL: 'mysql://db', REDIS_URL: 'redis://cache',
      JWT_SECRET: 'Q2x1a0dFc2VyYUJ1a2FuU2VjcmV0UHJvZHVrc2k2NFJhbmRvbQ==',
      WEB_ORIGIN: 'https://ares.example.com', TRUST_PROXY_HOPS: '1',
      SMTP_HOST: 'smtp.example.com',
    });
    expect(env.NODE_ENV).toBe('production');
    expect(env.WEB_ORIGIN).toBe('https://ares.example.com');
  });
});
