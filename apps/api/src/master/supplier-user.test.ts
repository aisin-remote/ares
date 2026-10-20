import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  and,
  auditLogs,
  closeDb,
  eq,
  getDb,
  roles,
  users,
  vendors,
} from '@ares/db';
import { MasterService } from './master.service';

const db = getDb();
const service = new MasterService(db);
const stamp = Date.now().toString().slice(-10);
const npk = `SUP-TEST-${stamp}`;
const email = `account-${stamp}@supplier-user.test`;
let adminUserId: number;
let supplierRoleId: number;
let adminRoleId: number;
let vendorId: number;
let plantId: number | null;
let createdId: number | undefined;

beforeAll(async () => {
  const [adminUser] = await db.select({ id: users.id }).from(users).where(eq(users.npk, 'ADMIN'));
  const roleRows = await db
    .select({ id: roles.id, name: roles.name })
    .from(roles);
  const [vendor] = await db
    .select({ id: vendors.id, plantId: vendors.plantId })
    .from(vendors)
    .where(eq(vendors.isActive, true))
    .limit(1);
  const supplierRole = roleRows.find((role) => role.name === 'supplier');
  const adminRole = roleRows.find((role) => role.name === 'admin');
  if (!adminUser || !supplierRole || !adminRole || !vendor) {
    throw new Error('Jalankan `pnpm db:seed` dulu');
  }
  adminUserId = adminUser.id;
  supplierRoleId = supplierRole.id;
  adminRoleId = adminRole.id;
  vendorId = vendor.id;
  plantId = vendor.plantId;
});

afterAll(async () => {
  if (createdId) {
    await db.delete(auditLogs).where(and(eq(auditLogs.entity, 'users'), eq(auditLogs.entityId, String(createdId))));
    await db.delete(users).where(eq(users.id, createdId));
  }
  await closeDb();
});

describe('pendaftaran akun supplier oleh PPIC', () => {
  it('mewajibkan email dan mencegah PPIC membuat akun internal', async () => {
    const base = {
      npk,
      name: 'Supplier User Test',
      roleId: supplierRoleId,
      vendorId,
      password: 'Password-awal-aman-2026',
      isActive: true,
    };
    await expect(
      service.create('users', base, { userId: adminUserId, role: 'ppic' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.create(
        'users',
        { ...base, email, roleId: adminRoleId, vendorId: null },
        { userId: adminUserId, role: 'ppic' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const created = await service.create(
      'users',
      { ...base, email: email.toUpperCase() },
      { userId: adminUserId, role: 'ppic' },
    );
    createdId = created.id;
    expect(created).toMatchObject({ email, vendorId, plantId, isActive: true });
    expect(created).not.toHaveProperty('passwordHash');
    expect(created).not.toHaveProperty('totpSecretEncrypted');
  });
});
