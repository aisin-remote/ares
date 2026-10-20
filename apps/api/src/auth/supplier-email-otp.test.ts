import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import {
  authChallenges,
  closeDb,
  eq,
  getDb,
  plants,
  roles,
  users,
  vendors,
} from '@ares/db';
import { AuthService } from './auth.service';
import type { QueueService } from '../queue/queue.service';

const db = getDb();
const stamp = Date.now().toString().slice(-10);
const email = `otp-${stamp}@supplier-login.test`;
const password = 'Password-supplier-aman-2026';
const queued: Array<{ jobName: string; payload: Record<string, unknown> }> = [];
const queue = {
  add: async (_queue: string, jobName: string, payload: Record<string, unknown>) => {
    queued.push({ jobName, payload });
    return 'test-job';
  },
} as unknown as QueueService;
let mfaPayload: Record<string, unknown> | undefined;
const jwt = {
  signAsync: async (payload: Record<string, unknown>) => {
    if (payload.kind === 'mfa') {
      mfaPayload = payload;
      return 'test-mfa-token';
    }
    return 'test-access-token';
  },
  verifyAsync: async (token: string) => {
    if (token !== 'test-mfa-token' || !mfaPayload) throw new Error('token salah');
    return mfaPayload;
  },
};
const service = new AuthService(db, jwt as never, queue);

let vendorId: number;
let userId: number;
const originalNodeEnv = process.env.NODE_ENV;
const originalDemoOtpAutofill = process.env.DEMO_OTP_AUTOFILL;

beforeAll(async () => {
  process.env.JWT_SECRET ||= 'test-email-otp-secret-with-at-least-32-characters';
  process.env.NODE_ENV = 'test';
  process.env.DEMO_OTP_AUTOFILL = 'true';
  const [plant] = await db.select({ id: plants.id }).from(plants).limit(1);
  const [supplierRole] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.name, 'supplier'))
    .limit(1);
  if (!plant || !supplierRole) throw new Error('Jalankan `pnpm db:seed` dulu');

  vendorId = (
    await db
      .insert(vendors)
      .values({
        sapVendorNo: `OTP${stamp}`,
        plantId: plant.id,
        name: 'Supplier OTP Test',
        email,
        isActive: true,
      })
      .$returningId()
  )[0]!.id;
  userId = (
    await db
      .insert(users)
      .values({
        npk: `SUP-OTP-${stamp}`,
        name: 'Operator OTP Test',
        email,
        passwordHash: await bcrypt.hash(password, 10),
        roleId: supplierRole.id,
        plantId: plant.id,
        vendorId,
        isActive: true,
      })
      .$returningId()
  )[0]!.id;
});

afterAll(async () => {
  await db.delete(authChallenges).where(eq(authChallenges.email, email));
  await db.delete(users).where(eq(users.id, userId));
  await db.delete(vendors).where(eq(vendors.id, vendorId));
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  if (originalDemoOtpAutofill === undefined) delete process.env.DEMO_OTP_AUTOFILL;
  else process.env.DEMO_OTP_AUTOFILL = originalDemoOtpAutofill;
  await closeDb();
});

describe('login supplier dengan OTP email', () => {
  it('mengirim OTP setelah password benar, membatasi percobaan, dan memakai kode sekali', async () => {
    const firstStep = await service.login({ npk: email, password }, '127.0.0.1');
    expect(firstStep).toMatchObject({
      mfaRequired: true,
      mfaToken: 'test-mfa-token',
      emailHint: expect.stringContaining('@supplier-login.test'),
    });

    const otpJob = queued.find((job) => job.jobName === 'send-login-otp');
    const code = String(otpJob?.payload.code ?? '');
    expect(code).toMatch(/^\d{6}$/);
    expect('demoOtpCode' in firstStep ? firstStep.demoOtpCode : undefined).toBe(code);
    const challengeId = String(mfaPayload?.challengeId ?? '');
    const [stored] = await db
      .select({ codeHash: authChallenges.codeHash })
      .from(authChallenges)
      .where(eq(authChallenges.id, challengeId));
    expect(stored?.codeHash).not.toContain(code);

    const wrongCode = code === '000000' ? '000001' : '000000';
    await expect(
      service.loginOtp({ mfaToken: 'test-mfa-token', otpCode: wrongCode }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    const [afterWrongCode] = await db
      .select({ attempts: authChallenges.attempts })
      .from(authChallenges)
      .where(eq(authChallenges.id, challengeId));
    expect(afterWrongCode?.attempts).toBe(1);

    const loggedIn = await service.loginOtp({ mfaToken: 'test-mfa-token', otpCode: code });
    expect(loggedIn.accessToken).toBe('test-access-token');
    expect(loggedIn.user.vendorId).toBe(vendorId);
    await expect(
      service.loginOtp({ mfaToken: 'test-mfa-token', otpCode: code }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('tidak pernah membocorkan OTP pada production meskipun flag demo aktif', async () => {
    process.env.NODE_ENV = 'production';
    try {
      const firstStep = await service.login({ npk: email, password }, '127.0.0.1');
      expect('demoOtpCode' in firstStep ? firstStep.demoOtpCode : undefined).toBeUndefined();
    } finally {
      process.env.NODE_ENV = 'test';
    }
  });
});
