import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import {
  and,
  auditLogs,
  closeDb,
  eq,
  getDb,
  inArray,
  orderStandards,
  parts,
  users,
  vendorParts,
  vendors,
} from '@ares/db';
import { MasterService } from './master.service';

const db = getDb();
const service = new MasterService(db);
const stamp = Date.now().toString().slice(-10);

let actor: { userId: number; role: string };
let vendorId: number;
let otherVendorId: number;
let partIds: number[] = [];
let vendorPartIds: number[] = [];

beforeAll(async () => {
  const [user] = await db.select({ id: users.id }).from(users).limit(1);
  if (!user) throw new Error('Jalankan `pnpm db:seed` dulu');
  actor = { userId: user.id, role: 'admin' };
  vendorId = (
    await db
      .insert(vendors)
      .values({ sapVendorNo: `OS${stamp}`, name: 'Supplier standar order' })
      .$returningId()
  )[0]!.id;
  otherVendorId = (
    await db
      .insert(vendors)
      .values({ sapVendorNo: `OT${stamp}`, name: 'Supplier standar lain' })
      .$returningId()
  )[0]!.id;

  for (const suffix of ['A', 'B', 'C']) {
    partIds.push(
      (
        await db
          .insert(parts)
          .values({
            sapMaterialNo: `OS-${stamp}-${suffix}`,
            partNo: `OS-${stamp}-${suffix}`,
            name: `Part standar ${suffix}`,
          })
          .$returningId()
      )[0]!.id,
    );
  }
  vendorPartIds = [
    (
      await db
        .insert(vendorParts)
        .values({ partId: partIds[0]!, vendorId, qtyPerBox: 24, backNo: 'OS-A' })
        .$returningId()
    )[0]!.id,
    (
      await db
        .insert(vendorParts)
        .values({ partId: partIds[1]!, vendorId, qtyPerBox: 30, backNo: 'OS-B' })
        .$returningId()
    )[0]!.id,
    (
      await db
        .insert(vendorParts)
        .values({ partId: partIds[2]!, vendorId: otherVendorId, qtyPerBox: 10, backNo: 'OS-C' })
        .$returningId()
    )[0]!.id,
  ];
});

afterAll(async () => {
  const standards = await db
    .select({ id: orderStandards.id })
    .from(orderStandards)
    .where(inArray(orderStandards.vendorPartId, vendorPartIds));
  if (standards.length) {
    await db
      .delete(auditLogs)
      .where(
        and(
          eq(auditLogs.entity, 'orderStandards'),
          inArray(auditLogs.entityId, standards.map((row) => String(row.id))),
        ),
      );
  }
  await db.delete(orderStandards).where(inArray(orderStandards.vendorPartId, vendorPartIds));
  await db.delete(vendorParts).where(inArray(vendorParts.id, vendorPartIds));
  await db.delete(parts).where(inArray(parts.id, partIds));
  await db.delete(vendors).where(inArray(vendors.id, [vendorId, otherVendorId]));
  await closeDb();
});

describe('MasterService.saveOrderStandards', () => {
  it('menyimpan seluruh part supplier sekaligus dan mencatat audit', async () => {
    const result = await service.saveOrderStandards(
      {
        vendorId,
        lines: [
          { vendorPartId: vendorPartIds[0], standardKanban: 5 },
          { vendorPartId: vendorPartIds[1], standardKanban: 0 },
        ],
      },
      actor,
    );
    expect(result).toEqual({ saved: 2, inactive: 0, unchanged: 0 });

    const rows = await db
      .select()
      .from(orderStandards)
      .where(inArray(orderStandards.vendorPartId, vendorPartIds.slice(0, 2)));
    expect(rows.map((row) => [row.vendorPartId, row.standardKanban, row.isActive])).toEqual([
      [vendorPartIds[0], 5, true],
      [vendorPartIds[1], 0, true],
    ]);
  });

  it('memperbarui nilai dan menonaktifkan kolom yang dikosongkan', async () => {
    const result = await service.saveOrderStandards(
      {
        vendorId,
        lines: [
          { vendorPartId: vendorPartIds[0], standardKanban: 7 },
          { vendorPartId: vendorPartIds[1], standardKanban: null },
        ],
      },
      actor,
    );
    expect(result).toEqual({ saved: 1, inactive: 1, unchanged: 0 });

    const rows = await db
      .select({
        vendorPartId: orderStandards.vendorPartId,
        standardKanban: orderStandards.standardKanban,
        isActive: orderStandards.isActive,
      })
      .from(orderStandards)
      .where(inArray(orderStandards.vendorPartId, vendorPartIds.slice(0, 2)));
    expect(rows).toEqual([
      { vendorPartId: vendorPartIds[0], standardKanban: 7, isActive: true },
      { vendorPartId: vendorPartIds[1], standardKanban: 0, isActive: false },
    ]);
  });

  it('menolak vendor part milik supplier lain tanpa menyimpan sebagian', async () => {
    await expect(
      service.saveOrderStandards(
        {
          vendorId,
          lines: [
            { vendorPartId: vendorPartIds[0], standardKanban: 9 },
            { vendorPartId: vendorPartIds[2], standardKanban: 4 },
          ],
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    const [own, other] = await Promise.all([
      db
        .select({ standardKanban: orderStandards.standardKanban })
        .from(orderStandards)
        .where(eq(orderStandards.vendorPartId, vendorPartIds[0]!)),
      db
        .select({ id: orderStandards.id })
        .from(orderStandards)
        .where(eq(orderStandards.vendorPartId, vendorPartIds[2]!)),
    ]);
    expect(own[0]?.standardKanban).toBe(7);
    expect(other).toHaveLength(0);
  });
});
