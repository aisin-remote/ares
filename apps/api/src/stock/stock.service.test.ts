import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import {
  getDb,
  closeDb,
  and,
  eq,
  auditLogs,
  parts,
  plants,
  stockMutations,
  sum,
  users,
} from '@ares/db';
import { StockService } from './stock.service';

/** F-42 terhadap DB `ares` lokal: penyesuaian = baris ADJUST + audit; saldo = SUM(DELTA_PCS). */
const db = getDb();
const svc = new StockService(db);
const stamp = Date.now().toString().slice(-10);

let actor: { userId: number; plantId: number };
let partId: number;

beforeAll(async () => {
  const [plant] = await db.select({ id: plants.id }).from(plants).limit(1);
  const [user] = await db.select({ id: users.id }).from(users).limit(1);
  if (!plant || !user) throw new Error('Jalankan `pnpm db:seed` dulu');
  actor = { userId: user.id, plantId: plant.id };
  partId = (
    await db
      .insert(parts)
      .values({ sapMaterialNo: `ST-${stamp}`, partNo: `ST-${stamp}`, name: 'Part stok uji' })
      .$returningId()
  )[0]!.id;
});

afterAll(async () => {
  await db.delete(stockMutations).where(eq(stockMutations.partId, partId));
  await db
    .delete(auditLogs)
    .where(and(eq(auditLogs.entity, 'stock'), eq(auditLogs.entityId, String(partId))));
  await db.delete(parts).where(eq(parts.id, partId));
  await closeDb();
});

describe('StockService.adjust (F-42)', () => {
  it('menulis baris ADJUST beralasan + jejak audit; saldo mengikuti jumlah mutasi', async () => {
    await svc.adjust({ partId, deltaPcs: 120, reason: 'Hasil stock opname' }, actor);
    const out = await svc.adjust({ partId, deltaPcs: -20, reason: 'Rusak saat handling' }, actor);
    expect(out).toMatchObject({ partId, deltaPcs: -20, sloc: process.env.SAP_SLOC ?? 'WH00' });

    const [saldo] = await db
      .select({ pcs: sum(stockMutations.deltaPcs) })
      .from(stockMutations)
      .where(eq(stockMutations.partId, partId));
    expect(Number(saldo?.pcs)).toBe(100);

    const rows = await db
      .select({
        type: stockMutations.type,
        note: stockMutations.note,
        userId: stockMutations.userId,
      })
      .from(stockMutations)
      .where(eq(stockMutations.partId, partId));
    expect(rows.every((r) => r.type === 'ADJUST' && r.userId === actor.userId)).toBe(true);
    expect(rows.map((r) => r.note)).toEqual(['Hasil stock opname', 'Rusak saat handling']);

    const audit = await db
      .select({ action: auditLogs.action, after: auditLogs.after })
      .from(auditLogs)
      .where(and(eq(auditLogs.entity, 'stock'), eq(auditLogs.entityId, String(partId))));
    expect(audit).toHaveLength(2);
    expect(audit[1]?.after).toMatchObject({ deltaPcs: -20, reason: 'Rusak saat handling' });
  });

  it('part tidak ada → 404', async () => {
    await expect(
      svc.adjust({ partId: 999_999_999, deltaPcs: 1, reason: 'uji' }, actor),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
