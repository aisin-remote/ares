import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import {
  and,
  auditLogs,
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
import { totpCode } from './totp';
import type { QueueService } from '../queue/queue.service';

// Render QR ESM sudah dipakai dan diuji modul dokumen; test ini fokus pada
// secret TOTP, transaksi akun, approval, dan kewajiban MFA saat login.
vi.mock('../document/pdf-runtime', () => ({ qrPng: async () => Buffer.from('fake-png') }));

const db = getDb();
const stamp = Date.now().toString().slice(-10);
const vendorCode = `RG${stamp}`;
const email = `operator-${stamp}@supplier-reg.test`;
const password = 'Password-supplier-aman-2026';
const queued: Array<{ jobName: string; payload: Record<string, unknown> }> = [];
const queue = {
  add: async (_queue: string, jobName: string, payload: Record<string, unknown>) => {
    queued.push({ jobName, payload });
    return 'test-job';
  },
} as unknown as QueueService;
const jwt = {
  signAsync: async (payload: { kind?: string }) =>
    payload.kind === 'mfa' ? 'test-mfa-token' : 'test-access-token',
  verifyAsync: async (token: string) => {
    if (token !== 'test-mfa-token') throw new Error('token salah');
    return { kind: 'mfa', purpose: 'LOGIN_TOTP', sub: createdUserId };
  },
};
const service = new AuthService(db, jwt as never, queue);

let vendorId: number;
let createdUserId: number;

beforeAll(async () => {
  process.env.JWT_SECRET ||= 'test-registration-secret-with-at-least-32-characters';
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
        sapVendorNo: vendorCode,
        plantId: plant.id,
        name: 'Supplier Registration Test',
        email: `contact-${stamp}@supplier-reg.test`,
        isActive: true,
      })
      .$returningId()
  )[0]!.id;
});

afterAll(async () => {
  const [created] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (created) {
    await db
      .delete(auditLogs)
      .where(and(eq(auditLogs.entity, 'users'), eq(auditLogs.entityId, String(created.id))));
    await db.delete(users).where(eq(users.id, created.id));
  }
  await db.delete(authChallenges).where(eq(authChallenges.vendorId, vendorId));
  await db.delete(vendors).where(eq(vendors.id, vendorId));
  await closeDb();
});

describe('pendaftaran supplier dengan Google Authenticator', () => {
  it('memasang TOTP, menunggu persetujuan, lalu mewajibkan kode saat login', async () => {
    const requested = await service.requestSupplierRegistration(
      {
        vendorCode,
        name: 'Operator Supplier',
        email,
      },
      '127.0.0.1',
    );
    expect(requested.challengeId).toMatch(/^[0-9a-f-]{36}$/);
    expect(requested.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(requested.setupKey).toMatch(/^[A-Z2-7]+$/);

    const code = totpCode(requested.setupKey);
    const wrongCode = String((Number(code) + 1) % 1_000_000).padStart(6, '0');
    await expect(
      service.verifySupplierRegistration({
        challengeId: requested.challengeId,
        code: wrongCode,
        password,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    const [afterWrongCode] = await db
      .select({ attempts: authChallenges.attempts })
      .from(authChallenges)
      .where(eq(authChallenges.id, requested.challengeId));
    expect(afterWrongCode?.attempts).toBe(1);

    const verified = await service.verifySupplierRegistration({
      challengeId: requested.challengeId,
      code,
      password,
    });
    expect(verified.status).toBe('PENDING_APPROVAL');

    const [created] = await db
      .select({
        id: users.id,
        vendorId: users.vendorId,
        isActive: users.isActive,
        totp: users.totpSecretEncrypted,
      })
      .from(users)
      .where(eq(users.email, email));
    expect(created).toMatchObject({ vendorId, isActive: false });
    createdUserId = created!.id;
    expect(created?.totp).toMatch(/^v1\./);
    expect(queued.some((job) => job.payload.kind === 'SUPPLIER_REGISTRATION_PENDING')).toBe(true);

    await db.update(users).set({ isActive: true }).where(eq(users.id, created!.id));
    const firstStep = await service.login({ npk: email, password });
    expect(firstStep).toEqual({ mfaRequired: true, mfaToken: 'test-mfa-token' });
    await expect(
      service.loginTotp({
        mfaToken: 'test-mfa-token',
        totpCode: wrongCode,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    const loggedIn = await service.loginTotp({
      mfaToken: 'test-mfa-token',
      totpCode: totpCode(requested.setupKey),
    });
    expect(loggedIn.accessToken).toBe('test-access-token');
    expect(loggedIn.user.vendorId).toBe(vendorId);
  });
});
