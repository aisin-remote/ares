import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import ExcelJS from 'exceljs';
import { BadRequestException } from '@nestjs/common';
import { getDb, closeDb, and, eq, inArray, auditLogs, bomLines, parts, users } from '@ares/db';
import { BomService } from './bom.service';

/**
 * F-03 terhadap DB `ares` lokal: upload Excel → TM_BOM → explodeBom 2 level.
 * Part uji ber-stamp unik dan dihapus di afterAll.
 */
const db = getDb();
const svc = new BomService(db);
const stamp = Date.now().toString().slice(-10);
const NO = { abc: `ABC-${stamp}`, a: `A-${stamp}`, d: `D-${stamp}`, b: `B-${stamp}` };

let actor: { userId: number; role: string };
let id: Record<keyof typeof NO, number>;

async function xlsx(rows: Array<Array<string | number | Date | null>>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('BOM');
  ws.addRow(['Part jadi', 'Komponen', 'Qty per', 'Berlaku dari', 'Berlaku sampai']);
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

beforeAll(async () => {
  const [user] = await db.select({ id: users.id }).from(users).limit(1);
  if (!user) throw new Error('Jalankan `pnpm db:seed` dulu');
  actor = { userId: user.id, role: 'admin' };

  const ids = {} as Record<keyof typeof NO, number>;
  for (const key of Object.keys(NO) as Array<keyof typeof NO>) {
    ids[key] = (
      await db
        .insert(parts)
        .values({ sapMaterialNo: NO[key], partNo: NO[key], name: `Part ${key.toUpperCase()}` })
        .$returningId()
    )[0]!.id;
  }
  id = ids;
});

afterAll(async () => {
  const partIds = Object.values(id);
  await db.delete(bomLines).where(inArray(bomLines.parentPartId, partIds));
  await db
    .delete(auditLogs)
    .where(and(eq(auditLogs.entity, 'bom'), eq(auditLogs.userId, actor.userId)));
  await db.delete(parts).where(inArray(parts.id, partIds));
  await closeDb();
});

describe('BomService.importExcel (F-03)', () => {
  it('membaca Excel 2 level, melewati baris cacat, mencatat satu jejak audit', async () => {
    // ABC → A ×1, ABC → B ×2, A → D ×0,8 (raw material kg); satu baris part tak dikenal.
    const buf = await xlsx([
      [NO.abc, NO.a, 1, '2026-01-01', null],
      [NO.abc, NO.b, 2, new Date(Date.UTC(2026, 0, 1)), ''],
      [NO.a, NO.d, 0.8, '2026-01-01', null],
      [NO.abc, `TIDAK-ADA-${stamp}`, 1, '2026-01-01', null],
      [NO.abc, NO.a, 'x', '2026-01-01', null],
    ]);
    const out = await svc.importExcel(buf, 'bom.xlsx', actor);
    expect(out).toMatchObject({ inserted: 3, updated: 0, skipped: 2 });
    expect(out.errors.map((e) => e.row)).toEqual([6, 5]);
    expect(out.errors.find((e) => e.row === 5)?.message).toMatch(/tidak ada di master part/);

    const rows = await db
      .select({ c: bomLines.componentPartId, q: bomLines.qtyPer, from: bomLines.effectiveFrom })
      .from(bomLines)
      .where(eq(bomLines.parentPartId, id.abc));
    expect(
      rows.map((r) => [r.c, Number(r.q), r.from]).sort((x, y) => Number(x[0]) - Number(y[0])),
    ).toEqual([
      [id.a, 1, '2026-01-01'],
      [id.b, 2, '2026-01-01'],
    ]);

    const audit = await db
      .select({ action: auditLogs.action, after: auditLogs.after })
      .from(auditLogs)
      .where(and(eq(auditLogs.entity, 'bom'), eq(auditLogs.userId, actor.userId)));
    expect(audit.at(-1)).toMatchObject({ action: 'IMPORT', after: { inserted: 3, errors: 2 } });
  });

  it('upload ulang (induk, komponen, mulai) yang sama memperbarui qty, tidak menggandakan', async () => {
    const buf = await xlsx([[NO.abc, NO.b, 3, '2026-01-01', '2026-12-31']]);
    const out = await svc.importExcel(buf, 'bom-2.xlsx', actor);
    expect(out).toMatchObject({ inserted: 0, updated: 1, skipped: 0 });
    const rows = await db
      .select({ q: bomLines.qtyPer, to: bomLines.effectiveTo })
      .from(bomLines)
      .where(and(eq(bomLines.parentPartId, id.abc), eq(bomLines.componentPartId, id.b)));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ q: '3.0000', to: '2026-12-31' });
  });

  it('berkas bukan xlsx → 400', async () => {
    await expect(svc.importExcel(Buffer.from('halo'), 'x.xlsx', actor)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('BomService.explode — BOM 2 level lewat explodeBom', () => {
  it('10 ABC → 10 A + 30 B → 8 kg D; daun = B dan D', async () => {
    const out = await svc.explode(id.abc, 10, '2026-06-01');
    expect(out.root).toMatchObject({ partNo: NO.abc, qty: 10 });
    const total = Object.fromEntries(out.totals.map((t) => [t.partNo, t.qty]));
    expect(total[NO.a]).toBe(10);
    expect(total[NO.b]).toBe(30);
    expect(total[NO.d]).toBeCloseTo(8, 6);
    expect(out.lines.find((l) => l.partNo === NO.d)).toMatchObject({
      level: 2,
      path: [id.abc, id.a],
    });
    expect(out.leaves.map((l) => l.partNo).sort()).toEqual([NO.b, NO.d].sort());
  });

  it('masa berlaku dihormati: setelah 2026-12-31 komponen B tidak ikut', async () => {
    const out = await svc.explode(id.abc, 1, '2027-01-15');
    expect(out.totals.map((t) => t.partNo).sort()).toEqual([NO.a, NO.d].sort());
  });

  it('part tanpa BOM → daftar kosong, bukan galat', async () => {
    const out = await svc.explode(id.d, 5);
    expect(out.lines).toEqual([]);
    expect(out.leaves).toEqual([]);
  });
});
