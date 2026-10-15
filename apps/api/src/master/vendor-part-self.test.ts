import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  getDb,
  closeDb,
  and,
  eq,
  inArray,
  auditLogs,
  parts,
  users,
  vendorParts,
  vendors,
} from '@ares/db';
import { MasterService } from './master.service';

/**
 * Supplier mengubah kemasan vendor part-nya sendiri: hanya kolom kemasan,
 * hanya barisnya sendiri, tercatat di audit. Data uji ber-stamp unik.
 */
const db = getDb();
const svc = new MasterService(db);
const stamp = Date.now().toString().slice(-10);

let actor: { userId: number; role: string; vendorId: number };
let vendorLain: number;
let partId: number;
let vpId: number;
let vpLainId: number;

beforeAll(async () => {
  const [user] = await db.select({ id: users.id }).from(users).limit(1);
  if (!user) throw new Error('Jalankan `pnpm db:seed` dulu');

  const vendorId = (
    await db
      .insert(vendors)
      .values({ sapVendorNo: `VP${stamp}`, name: 'Supplier kemasan' })
      .$returningId()
  )[0]!.id;
  vendorLain = (
    await db
      .insert(vendors)
      .values({ sapVendorNo: `VQ${stamp}`, name: 'Supplier lain' })
      .$returningId()
  )[0]!.id;
  actor = { userId: user.id, role: 'supplier', vendorId };

  partId = (
    await db
      .insert(parts)
      .values({ sapMaterialNo: `VP-${stamp}`, partNo: `VP-${stamp}`, name: 'Part kemasan' })
      .$returningId()
  )[0]!.id;
  vpId = (
    await db
      .insert(vendorParts)
      .values({ partId, vendorId, qtyPerBox: 100, backNo: 'A-01', rack: 'R-1', boxType: 'PLASTIK' })
      .$returningId()
  )[0]!.id;
  vpLainId = (
    await db
      .insert(vendorParts)
      .values({ partId, vendorId: vendorLain, qtyPerBox: 50, backNo: 'B-01' })
      .$returningId()
  )[0]!.id;
});

afterAll(async () => {
  await db
    .delete(auditLogs)
    .where(
      and(
        eq(auditLogs.entity, 'vendorParts'),
        inArray(auditLogs.entityId, [String(vpId), String(vpLainId)]),
      ),
    );
  await db.delete(vendorParts).where(inArray(vendorParts.id, [vpId, vpLainId]));
  await db.delete(parts).where(eq(parts.id, partId));
  await db.delete(vendors).where(inArray(vendors.id, [actor.vendorId, vendorLain]));
  await closeDb();
});

describe('MasterService.updateVendorPartSelf', () => {
  it('mengubah back number, rak, dan tipe box milik sendiri + jejak audit', async () => {
    const { row, before } = await svc.updateVendorPartSelf(
      vpId,
      { backNo: 'A-09', rack: 'R-7', boxType: 'BESI' },
      actor,
    );
    expect(before).toMatchObject({ backNo: 'A-01', rack: 'R-1' });
    expect(row).toMatchObject({ backNo: 'A-09', rack: 'R-7', boxType: 'BESI', qtyPerBox: 100 });

    const audit = await db
      .select({ action: auditLogs.action, userId: auditLogs.userId })
      .from(auditLogs)
      .where(and(eq(auditLogs.entity, 'vendorParts'), eq(auditLogs.entityId, String(vpId))));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'UPDATE_BY_VENDOR', userId: actor.userId });
  });

  it('rak boleh dikosongkan kembali', async () => {
    const { row } = await svc.updateVendorPartSelf(vpId, { rack: '' }, actor);
    expect(row.rack).toBeNull();
  });

  it('kolom di luar kemasan ditolak, bukan diabaikan diam-diam', async () => {
    await expect(svc.updateVendorPartSelf(vpId, { qtyPerBox: 1 }, actor)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      svc.updateVendorPartSelf(vpId, { backNo: 'A-10', vendorId: vendorLain }, actor),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.updateVendorPartSelf(vpId, { isActive: false }, actor)).rejects.toBeInstanceOf(
      BadRequestException,
    );

    const [row] = await db
      .select({ qtyPerBox: vendorParts.qtyPerBox, vendorId: vendorParts.vendorId })
      .from(vendorParts)
      .where(eq(vendorParts.id, vpId));
    expect(row).toEqual({ qtyPerBox: 100, vendorId: actor.vendorId });
  });

  it('vendor part supplier lain → 404, isinya tidak berubah', async () => {
    await expect(
      svc.updateVendorPartSelf(vpLainId, { backNo: 'X-99' }, actor),
    ).rejects.toBeInstanceOf(NotFoundException);
    const [row] = await db
      .select({ backNo: vendorParts.backNo })
      .from(vendorParts)
      .where(eq(vendorParts.id, vpLainId));
    expect(row?.backNo).toBe('B-01');
  });

  it('body kosong → 400', async () => {
    await expect(svc.updateVendorPartSelf(vpId, {}, actor)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
