import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import {
  getDb,
  closeDb,
  eq,
  and,
  inArray,
  asc,
  plants,
  users,
  vendors,
  parts,
  vendorParts,
  vendorCutoffs,
  poHeaders,
  poLines,
  picklistHeaders,
  picklistLines,
  kanbans,
  kanbanEvents,
  receiptHeaders,
  receiptLines,
  scanEvents,
  stockMutations,
  sapOutbox,
} from '@ares/db';
import { formatScanCode } from '@ares/domain';
import { ReceivingService } from './receiving.service';
import { PicklistService } from '../picklist/picklist.service';
import { SapOutboxService } from '../sap/sap-outbox.service';
import { SequenceService } from '../common/sequence.service';
import type { QueueService } from '../queue/queue.service';

/**
 * Alur F-34–F-38 + 6.5.3 terhadap DB `ares` lokal: terbit picklist → buka sesi
 * → scan → tutup → outbox GR. Data uji ber-stamp unik, dihapus di afterAll.
 */
const db = getDb();
const queue = { add: async () => 'test' } as unknown as QueueService;
const sequence = new SequenceService();
const picklists = new PicklistService(db, sequence, queue);
const receiving = new ReceivingService(db, sequence);
const outbox = new SapOutboxService(db);
const stamp = Date.now().toString().slice(-10);

let actor: { userId: number; plantId: number };
let plantCode: string;
let vendorId: number;
let partA: number;
let partB: number;
let vpA: number;
let vpB: number;

const kanbanCode = (id: string) => formatScanCode({ kind: 'KANBAN', id });
const picklistCode = (no: string) => formatScanCode({ kind: 'PICKLIST', no, revision: 0 });

/** Picklist manual dengan kanban terurut per serial; [lineIdx][boxIdx]. */
async function issue(lines: Array<{ vendorPartId: number; boxes: number }>) {
  const out = await picklists.issueManual({ vendorId, deliveryDate: '2026-09-25', lines }, actor);
  const detail = await picklists.get(out.id, null);
  return {
    id: out.id,
    picklistNo: out.picklistNo,
    lines: detail.lines.map((l) => ({ id: l.id, kanbanIds: l.kanbans.map((k) => k.id) })),
  };
}

beforeAll(async () => {
  const [plant] = await db.select({ id: plants.id, code: plants.code }).from(plants).limit(1);
  const [user] = await db.select({ id: users.id }).from(users).limit(1);
  if (!plant || !user)
    throw new Error('Jalankan `pnpm db:seed` dulu: butuh satu pabrik dan satu user');
  actor = { userId: user.id, plantId: plant.id };
  plantCode = plant.code;

  vendorId = (
    await db
      .insert(vendors)
      .values({ sapVendorNo: `R${stamp}`, name: 'Supplier receiving' })
      .$returningId()
  )[0]!.id;
  partA = (
    await db
      .insert(parts)
      .values({ sapMaterialNo: `RA-${stamp}`, partNo: `RA-${stamp}`, name: 'Part RA' })
      .$returningId()
  )[0]!.id;
  partB = (
    await db
      .insert(parts)
      .values({ sapMaterialNo: `RB-${stamp}`, partNo: `RB-${stamp}`, name: 'Part RB' })
      .$returningId()
  )[0]!.id;
  vpA = (
    await db
      .insert(vendorParts)
      .values({ partId: partA, vendorId, qtyPerBox: 100, backNo: 'RA-1' })
      .$returningId()
  )[0]!.id;
  vpB = (
    await db
      .insert(vendorParts)
      .values({ partId: partB, vendorId, qtyPerBox: 50, backNo: 'RB-1' })
      .$returningId()
  )[0]!.id;
  await db
    .insert(vendorCutoffs)
    .values({ vendorId, cutoffTime: '10:00:00', arrivalTime: '14:00:00' });
  const poId = (
    await db
      .insert(poHeaders)
      .values({ sapPoNo: `46${stamp}`, vendorId, validFrom: '2026-01-01', validTo: '2026-12-31' })
      .$returningId()
  )[0]!.id;
  await db.insert(poLines).values([
    { poId, item: '00010', partId: partA, openQty: 1000, syncedAt: new Date() },
    { poId, item: '00020', partId: partB, openQty: 1000, syncedAt: new Date() },
  ]);
});

afterAll(async () => {
  const pls = await db
    .select({ id: picklistHeaders.id })
    .from(picklistHeaders)
    .where(eq(picklistHeaders.vendorId, vendorId));
  const plIds = pls.map((p) => p.id);
  if (plIds.length > 0) {
    const rcs = await db
      .select({ id: receiptHeaders.id })
      .from(receiptHeaders)
      .where(inArray(receiptHeaders.picklistId, plIds));
    const rcIds = rcs.map((r) => r.id);
    if (rcIds.length > 0) {
      await db
        .delete(sapOutbox)
        .where(and(eq(sapOutbox.sourceTable, 'TT_RECEIPT_H'), inArray(sapOutbox.sourceId, rcIds)));
      await db.delete(scanEvents).where(inArray(scanEvents.sessionId, rcIds));
    }
    await db.delete(stockMutations).where(inArray(stockMutations.partId, [partA, partB]));
    const lines = await db
      .select({ id: picklistLines.id })
      .from(picklistLines)
      .where(inArray(picklistLines.picklistId, plIds));
    const lineIds = lines.map((l) => l.id);
    if (lineIds.length > 0) {
      const ks = await db
        .select({ id: kanbans.id })
        .from(kanbans)
        .where(inArray(kanbans.picklistLineId, lineIds));
      const kIds = ks.map((k) => k.id);
      if (kIds.length > 0) {
        await db.delete(kanbanEvents).where(inArray(kanbanEvents.kanbanId, kIds));
        await db.delete(kanbans).where(inArray(kanbans.id, kIds));
      }
    }
    if (rcIds.length > 0) await db.delete(receiptHeaders).where(inArray(receiptHeaders.id, rcIds)); // line ikut
    await db.delete(picklistHeaders).where(inArray(picklistHeaders.id, plIds));
  }
  await db.delete(poHeaders).where(eq(poHeaders.vendorId, vendorId));
  await db.delete(vendorParts).where(eq(vendorParts.vendorId, vendorId));
  await db.delete(vendors).where(eq(vendors.id, vendorId));
  await db.delete(parts).where(inArray(parts.id, [partA, partB]));
  await closeDb();
});

describe('sesi scan: buka → 5 scan (1 dobel, 1 picklist lain) → tutup → outbox GR', () => {
  it('menjalankan alur lengkap dan hasilnya konsisten di semua tabel', async () => {
    // Picklist A: 3 box RA (100/box) + 2 box RB (50/box). Picklist B: umpan kanban asing.
    const A = await issue([
      { vendorPartId: vpA, boxes: 3 },
      { vendorPartId: vpB, boxes: 2 },
    ]);
    const B = await issue([{ vendorPartId: vpA, boxes: 1 }]);
    const [a1, a2] = A.lines[0]!.kanbanIds;
    const [b1] = A.lines[1]!.kanbanIds;
    const foreign = B.lines[0]!.kanbanIds[0]!;

    // ── buka ──
    const sesi = await receiving.open(picklistCode(A.picklistNo), actor);
    expect(sesi.receiptNo).toMatch(/^RCP-\d{6}-\d{4}$/);
    expect(sesi).toMatchObject({ status: 'OPEN', resumed: false, picklistNo: A.picklistNo });
    expect(sesi.totals).toEqual({ boxOrdered: 5, boxShipped: 0, boxScanned: 0 });
    // scan ulang barcode picklist → sesi yang sama (F-39), bukan sesi kedua
    const lagi = await receiving.open(picklistCode(A.picklistNo), actor);
    expect(lagi).toMatchObject({ id: sesi.id, resumed: true });

    // ── 5 scan ──
    const s1 = await receiving.scan(sesi.id, kanbanCode(a1!), actor);
    // picklist belum dikonfirmasi supplier → kanban masih PRINTED → diterima + penanda otomatis
    expect(s1).toMatchObject({ result: 'OK', autoShipped: true, kanbanSerial: 1 });
    expect(s1.line).toMatchObject({ id: A.lines[0]!.id, boxOrdered: 3, boxScanned: 1 });

    const s2 = await receiving.scan(sesi.id, kanbanCode(a2!), actor);
    expect(s2).toMatchObject({ result: 'OK' });
    expect(s2.line?.boxScanned).toBe(2);

    const s3 = await receiving.scan(sesi.id, kanbanCode(a2!), actor); // dobel
    expect(s3.result).toBe('DUPLICATE');
    expect(s3.message).toMatch(/^Sudah diterima \d{2}:\d{2}$/);
    expect(s3.line?.boxScanned).toBe(2);

    const s4 = await receiving.scan(sesi.id, kanbanCode(foreign), actor); // picklist lain
    expect(s4).toMatchObject({
      result: 'REJECTED',
      message: `Kanban picklist ${B.picklistNo}-0`,
      line: null,
    });

    const s5 = await receiving.scan(sesi.id, kanbanCode(b1!), actor);
    expect(s5).toMatchObject({ result: 'OK', kanbanSerial: 4 });

    const s6 = await receiving.scan(sesi.id, 'BUKAN-KODE-ARES', actor);
    expect(s6).toMatchObject({ result: 'REJECTED', message: 'Kode tidak dikenal' });

    // TT_SCAN_EVENT: dobel tidak menggandakan (F-38); yang ditolak tetap tercatat
    const events = await db
      .select({ code: scanEvents.code, result: scanEvents.result })
      .from(scanEvents)
      .where(eq(scanEvents.sessionId, sesi.id))
      .orderBy(asc(scanEvents.id));
    expect(events.map((e) => e.result)).toEqual(['OK', 'OK', 'REJECTED', 'OK', 'REJECTED']);

    const progress = await receiving.get(sesi.id);
    expect(progress.totals.boxScanned).toBe(3);
    expect(progress.lines.map((l) => l.boxScanned)).toEqual([2, 1]);

    // ── tutup: 2 kanban belum datang → alasan wajib ──
    await expect(receiving.close(sesi.id, undefined, actor)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    const closed = await receiving.close(sesi.id, 'Truk datang kurang 2 box', actor);
    expect(closed).toMatchObject({
      picklistStatus: 'PARTIAL',
      missingCount: 2,
      receiptNo: sesi.receiptNo,
    });

    // picklist: ISSUED → (DOWNLOADED → SHIPPED otomatis) → PARTIAL
    const [pl] = await db.select().from(picklistHeaders).where(eq(picklistHeaders.id, A.id));
    expect(pl?.status).toBe('PARTIAL');
    const lines = await db
      .select({ boxReceived: picklistLines.boxReceived, status: picklistLines.status })
      .from(picklistLines)
      .where(eq(picklistLines.picklistId, A.id))
      .orderBy(asc(picklistLines.id));
    expect(lines).toEqual([
      { boxReceived: 2, status: 'OPEN' },
      { boxReceived: 1, status: 'OPEN' },
    ]);

    // kanban: 3 RECEIVED di sesi ini, 2 MISSING; kanban picklist B tidak tersentuh
    const ks = await db
      .select({ status: kanbans.status, receiptId: kanbans.receiptId })
      .from(kanbans)
      .innerJoin(picklistLines, eq(kanbans.picklistLineId, picklistLines.id))
      .where(eq(picklistLines.picklistId, A.id))
      .orderBy(asc(kanbans.serial));
    expect(ks.map((k) => k.status)).toEqual([
      'RECEIVED',
      'RECEIVED',
      'MISSING',
      'RECEIVED',
      'MISSING',
    ]);
    expect(ks.filter((k) => k.status === 'RECEIVED').every((k) => k.receiptId === sesi.id)).toBe(
      true,
    );
    const [fk] = await db
      .select({ status: kanbans.status })
      .from(kanbans)
      .where(eq(kanbans.id, foreign));
    expect(fk?.status).toBe('PRINTED');

    // TT_RECEIPT_L: pcs per line
    const rl = await db
      .select({
        picklistLineId: receiptLines.picklistLineId,
        boxReceived: receiptLines.boxReceived,
        pcsReceived: receiptLines.pcsReceived,
      })
      .from(receiptLines)
      .where(eq(receiptLines.receiptId, sesi.id))
      .orderBy(asc(receiptLines.id));
    expect(rl).toEqual([
      { picklistLineId: A.lines[0]!.id, boxReceived: 2, pcsReceived: 200 },
      { picklistLineId: A.lines[1]!.id, boxReceived: 1, pcsReceived: 50 },
    ]);

    // TT_STOCK_MUTATION: satu RECEIPT per receipt line (6.5.4)
    const sm = await db
      .select({
        partId: stockMutations.partId,
        deltaPcs: stockMutations.deltaPcs,
        type: stockMutations.type,
        refTable: stockMutations.refTable,
      })
      .from(stockMutations)
      .where(inArray(stockMutations.partId, [partA, partB]))
      .orderBy(asc(stockMutations.id));
    expect(sm).toEqual([
      { partId: partA, deltaPcs: 200, type: 'RECEIPT', refTable: 'TT_RECEIPT_L' },
      { partId: partB, deltaPcs: 50, type: 'RECEIPT', refTable: 'TT_RECEIPT_L' },
    ]);

    // sesi CLOSED, tidak bisa discan/ditutup lagi
    await expect(receiving.scan(sesi.id, kanbanCode(a1!), actor)).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(receiving.close(sesi.id, 'lagi', actor)).rejects.toBeInstanceOf(ConflictException);

    // ── outbox GR: satu baris per receipt CLOSED, idempoten ──
    const c1 = await outbox.collect();
    expect(c1.dikumpulkan).toBeGreaterThanOrEqual(1);
    const rows = await db
      .select()
      .from(sapOutbox)
      .where(and(eq(sapOutbox.sourceTable, 'TT_RECEIPT_H'), eq(sapOutbox.sourceId, sesi.id)));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      docType: 'GR',
      movementType: '101',
      idempotencyKey: sesi.receiptNo,
      status: 'PENDING',
    });
    expect(rows[0]!.payload).toMatchObject({
      docType: 'GR',
      idempotencyKey: sesi.receiptNo,
      plant: plantCode,
      sloc: 'WH00',
      deliveryNote: A.picklistNo,
      items: [
        { poNo: `46${stamp}`, poItem: '00010', material: `RA-${stamp}`, qty: 200, uom: 'PC' },
        { poNo: `46${stamp}`, poItem: '00020', material: `RB-${stamp}`, qty: 50, uom: 'PC' },
      ],
    });
    expect((rows[0]!.payload as { postingDate: string }).postingDate).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );

    // putaran berikutnya tidak menggandakan
    await outbox.collect();
    const again = await db
      .select({ id: sapOutbox.id })
      .from(sapOutbox)
      .where(and(eq(sapOutbox.sourceTable, 'TT_RECEIPT_H'), eq(sapOutbox.sourceId, sesi.id)));
    expect(again).toHaveLength(1);
  });

  it('semua kanban discan → COMPLETE tanpa alasan; sesi baru pada picklist COMPLETE ditolak', async () => {
    const C = await issue([{ vendorPartId: vpA, boxes: 1 }]);
    const sesi = await receiving.open(picklistCode(C.picklistNo), actor);
    await receiving.scan(sesi.id, kanbanCode(C.lines[0]!.kanbanIds[0]!), actor);
    const closed = await receiving.close(sesi.id, undefined, actor);
    expect(closed).toMatchObject({ picklistStatus: 'COMPLETE', missingCount: 0 });

    const [line] = await db
      .select({ status: picklistLines.status, boxReceived: picklistLines.boxReceived })
      .from(picklistLines)
      .where(eq(picklistLines.picklistId, C.id));
    expect(line).toEqual({ status: 'RECEIVED', boxReceived: 1 });

    await expect(receiving.open(picklistCode(C.picklistNo), actor)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('sesi tanpa satu pun scan → semua MISSING, receipt tanpa line, outbox SKIPPED', async () => {
    const D = await issue([{ vendorPartId: vpB, boxes: 1 }]);
    const sesi = await receiving.open(picklistCode(D.picklistNo), actor);
    const closed = await receiving.close(sesi.id, 'Truk tidak datang', actor);
    expect(closed).toMatchObject({
      picklistStatus: 'PARTIAL',
      missingCount: 1,
      lines: [{ boxReceived: 0, boxMissing: 1 }],
    });

    await outbox.collect();
    const [row] = await db
      .select({ status: sapOutbox.status })
      .from(sapOutbox)
      .where(and(eq(sapOutbox.sourceTable, 'TT_RECEIPT_H'), eq(sapOutbox.sourceId, sesi.id)));
    expect(row?.status).toBe('SKIPPED');
  });

  it('barcode bukan picklist / picklist tidak ada → ditolak sebelum menyentuh DB', async () => {
    await expect(receiving.open('ARES:K:01J8Z3M5X8Q9W2Y7V6T5R4S3P2', actor)).rejects.toThrow(
      /Bukan barcode picklist/,
    );
    await expect(receiving.open('ARES:P:PL-000101-9999-0', actor)).rejects.toThrow(
      /tidak ditemukan/,
    );
  });
});
