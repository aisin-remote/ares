import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import {
  getDb,
  closeDb,
  eq,
  and,
  asc,
  inArray,
  count,
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
  receiptHeaders,
  kanbans,
  kanbanEvents,
  auditLogs,
  orderQueues,
  queueAdjustments,
} from '@ares/db';
import { formatScanCode, orderPlantInitial, orderSheetDisplayNo, parseScanCode } from '@ares/domain';
import { PicklistService } from './picklist.service';
import { SequenceService } from '../common/sequence.service';
import type { QueueService } from '../queue/queue.service';

/**
 * Menjalankan service terhadap DB `ares` lokal (DATABASE_URL di .env root).
 * Data uji diberi kode unik per run dan dihapus di akhir; tabel lain tidak disentuh.
 */
const db = getDb();
// Antrean tiruan: job render PDF (F-27) tidak termasuk yang diuji di sini, dan
// test tidak boleh menuntut Redis hidup.
const jobs: Array<{ queue: string; name: string; payload: unknown }> = [];
const queue = {
  add: async (queueName: string, jobName: string, payload: unknown) => {
    jobs.push({ queue: queueName, name: jobName, payload });
    return 'test';
  },
} as unknown as QueueService;
const svc = new PicklistService(db, new SequenceService(), queue);
const stamp = Date.now().toString().slice(-10);

let actor: { userId: number; plantId: number };
let plantCode: string;
let vendorId: number;
let partA: number;
let partB: number;
let vpA: number;
let vpB: number;

beforeAll(async () => {
  // Pabrik dan user dari seed (pnpm db:seed); CREATED_BY_ID / USER_ID adalah FK ke TM_USER.
  const [plant] = await db.select({ id: plants.id, code: plants.code }).from(plants).limit(1);
  const [user] = await db.select({ id: users.id }).from(users).limit(1);
  if (!plant || !user)
    throw new Error('Jalankan `pnpm db:seed` dulu: butuh satu pabrik dan satu user');
  actor = { userId: user.id, plantId: plant.id };
  plantCode = plant.code;

  vendorId = (
    await db
      .insert(vendors)
      .values({ sapVendorNo: `T${stamp}`, plantId: actor.plantId, name: 'Supplier uji' })
      .$returningId()
  )[0]!.id;
  partA = (
    await db
      .insert(parts)
      .values({ sapMaterialNo: `TA-${stamp}`, partNo: `TA-${stamp}`, name: 'Part A' })
      .$returningId()
  )[0]!.id;
  partB = (
    await db
      .insert(parts)
      .values({ sapMaterialNo: `TB-${stamp}`, partNo: `TB-${stamp}`, name: 'Part B' })
      .$returningId()
  )[0]!.id;
  vpA = (
    await db
      .insert(vendorParts)
      .values({ partId: partA, vendorId, qtyPerBox: 100, backNo: 'A-1' })
      .$returningId()
  )[0]!.id;
  vpB = (
    await db
      .insert(vendorParts)
      .values({ partId: partB, vendorId, qtyPerBox: 50, backNo: 'B-1' })
      .$returningId()
  )[0]!.id;
  await db
    .insert(vendorCutoffs)
    .values({ vendorId, cutoffTime: '10:00:00', arrivalTime: '14:00:00' });

  // PO hanya untuk part A, berlaku sepanjang 2026. Part B sengaja tanpa PO (F-18).
  const poId = (
    await db
      .insert(poHeaders)
      .values({ sapPoNo: `45${stamp}`, vendorId, validFrom: '2026-01-01', validTo: '2026-12-31' })
      .$returningId()
  )[0]!.id;
  await db
    .insert(poLines)
    .values({ poId, item: '00010', partId: partA, openQty: 1_000_000, syncedAt: new Date() });
});

afterAll(async () => {
  const pls = await db
    .select({ id: picklistHeaders.id })
    .from(picklistHeaders)
    .where(eq(picklistHeaders.vendorId, vendorId));
  const plIds = pls.map((p) => p.id);
  if (plIds.length > 0) {
    await db.delete(auditLogs).where(and(eq(auditLogs.entity, 'TT_PICKLIST_H'),
      inArray(auditLogs.entityId, plIds.map(String))));
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
    await db.delete(picklistHeaders).where(inArray(picklistHeaders.id, plIds)); // line ikut (cascade)
  }
  await db.delete(poHeaders).where(eq(poHeaders.vendorId, vendorId)); // PO line ikut (cascade)
  const queueRows = await db.select({ id: orderQueues.id }).from(orderQueues)
    .where(inArray(orderQueues.vendorPartId, [vpA, vpB]));
  if (queueRows.length > 0) {
    await db.delete(queueAdjustments).where(inArray(queueAdjustments.queueId, queueRows.map((row) => row.id)));
    await db.delete(auditLogs).where(and(eq(auditLogs.entity, 'TT_ORDER_QUEUE'),
      inArray(auditLogs.entityId, queueRows.map((row) => String(row.id)))));
    await db.delete(orderQueues).where(inArray(orderQueues.id, queueRows.map((row) => row.id)));
  }
  await db.delete(vendorParts).where(eq(vendorParts.vendorId, vendorId));
  await db.delete(vendors).where(eq(vendors.id, vendorId)); // cutoff ikut (cascade)
  await db.delete(parts).where(inArray(parts.id, [partA, partB]));
  await closeDb();
});

describe('PicklistService.issueManual (F-17, F-21, F-22, 6.6.1)', () => {
  it('order manual terbit: header ISSUED/MANUAL, line ber-PO, satu kanban PRINTED per box', async () => {
    const out = await svc.issueManual(
      { vendorId, deliveryDate: '2026-09-25', lines: [{ vendorPartId: vpA, boxes: 3 }] },
      actor,
    );

    expect(out.picklistNo).toMatch(new RegExp(`^${orderPlantInitial(plantCode)}260925\\d{3}00$`));
    expect(out.publicId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    await expect(svc.resolveId(out.publicId, null, actor.plantId)).resolves.toBe(out.id);
    // URL numerik lama tetap diterima selama masa transisi.
    await expect(svc.resolveId(String(out.id), null, actor.plantId)).resolves.toBe(out.id);
    expect(out).toMatchObject({ revision: 0, lineCount: 1, kanbanCount: 3 });
    // Nomor harus terbaca kembali sebagai barcode picklist (8.3).
    expect(parseScanCode(formatScanCode({ kind: 'PICKLIST', no: out.picklistNo, revision: 0 }))).toEqual({
      kind: 'PICKLIST',
      no: out.picklistNo,
      revision: 0,
    });

    const detail = await svc.get(out.id, null);
    expect(detail).toMatchObject({
      status: 'ISSUED',
      type: 'MANUAL',
      deliveryDate: '2026-09-25',
      arrivalTime: '14:00:00',
    });
    expect(detail.lines).toHaveLength(1);
    expect(detail.lines[0]).toMatchObject({
      boxOrdered: 3,
      qtyPerBox: 100,
      pcs: 300,
      sapPoNo: `45${stamp}`,
      sapPoItem: '00010',
      status: 'OPEN',
    });
    expect(detail.lines[0]!.kanbans.map((k) => k.serial)).toEqual([1, 2, 3]);
    expect(
      detail.lines[0]!.kanbans.every((k) => k.status === 'PRINTED' && /^[0-9A-Z]{26}$/.test(k.id)),
    ).toBe(true);

    const [ev] = await db
      .select({ n: count() })
      .from(kanbanEvents)
      .where(
        inArray(
          kanbanEvents.kanbanId,
          detail.lines[0]!.kanbans.map((k) => k.id),
        ),
      );
    expect(Number(ev?.n)).toBe(3);
    const [audit] = await db.select({ action: auditLogs.action }).from(auditLogs)
      .where(and(eq(auditLogs.entity, 'TT_PICKLIST_H'), eq(auditLogs.entityId, String(out.id))));
    expect(audit?.action).toBe('ISSUE');
  });

  it('PPIC dapat upload order ke supplier plant lain; nomor dan header tetap memakai plant PPIC', async () => {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('ORDER_MANUAL');
    sheet.getCell('B3').value = `T${stamp}`;
    sheet.getCell('B4').value = '2026-09-25';
    sheet.getCell('B5').value = '10:00';
    sheet.getRow(8).values = ['NOMOR_MATERIAL_SAP', 'JUMLAH_BOX'];
    sheet.getRow(9).values = [`TA-${stamp}`, 2];

    const supplierPlant = (await db.select({ id: plants.id }).from(plants))
      .find((plant) => plant.id !== actor.plantId);
    if (!supplierPlant) throw new Error('Test membutuhkan plant kedua');
    await db.update(vendors).set({ plantId: supplierPlant.id }).where(eq(vendors.id, vendorId));
    try {
      const out = await svc.importManualExcel(Buffer.from(await book.xlsx.writeBuffer()), actor);
      const detail = await svc.get(out.id, null);
      const [header] = await db.select({ plantId: picklistHeaders.plantId })
        .from(picklistHeaders).where(eq(picklistHeaders.id, out.id));
      expect(out.picklistNo).toMatch(new RegExp(`^${orderPlantInitial(plantCode)}260925\\d{3}00$`));
      expect(out).toMatchObject({ lineCount: 1, kanbanCount: 2 });
      expect(header?.plantId).toBe(actor.plantId);
      expect(detail).toMatchObject({ type: 'MANUAL', deliveryDate: '2026-09-25', arrivalTime: '14:00:00' });
      expect(detail.lines[0]).toMatchObject({ boxOrdered: 2, pcs: 200 });
    } finally {
      await db.update(vendors).set({ plantId: actor.plantId }).where(eq(vendors.id, vendorId));
    }
  });

  it('nomor berurutan per plant dan tanggal delivery', async () => {
    const a = await svc.issueManual(
      { vendorId, deliveryDate: '2026-09-25', lines: [{ vendorPartId: vpA, boxes: 1 }] },
      actor,
    );
    const b = await svc.issueManual(
      { vendorId, deliveryDate: '2026-09-25', lines: [{ vendorPartId: vpA, boxes: 2 }] },
      actor,
    );
    expect(Number(b.picklistNo.slice(7, 10))).toBe(Number(a.picklistNo.slice(7, 10)) + 1);
    expect(b.picklistNo.slice(0, 7)).toBe(a.picklistNo.slice(0, 7));
    expect(b.picklistNo.slice(-2)).toBe('00');
  });

  it('satu part tanpa PO item aktif → seluruh order ditolak, tidak ada yang tersimpan (F-18)', async () => {
    const before = await db
      .select({ n: count() })
      .from(picklistHeaders)
      .where(eq(picklistHeaders.vendorId, vendorId));
    await expect(
      svc.issueManual(
        {
          vendorId,
          deliveryDate: '2026-09-25',
          lines: [
            { vendorPartId: vpA, boxes: 1 },
            { vendorPartId: vpB, boxes: 1 },
          ],
        },
        actor,
      ),
    ).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof UnprocessableEntityException &&
        String((e as Error).message).includes(`TB-${stamp}`),
    );
    const after = await db
      .select({ n: count() })
      .from(picklistHeaders)
      .where(eq(picklistHeaders.vendorId, vendorId));
    expect(Number(after[0]?.n)).toBe(Number(before[0]?.n));
  });

  it('PO tidak berlaku pada tanggal kirim → ditolak (6.6.1)', async () => {
    await expect(
      svc.issueManual(
        { vendorId, deliveryDate: '2027-01-05', lines: [{ vendorPartId: vpA, boxes: 1 }] },
        actor,
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('outstanding aktif + pcs baru melebihi OPEN_QTY → seluruh order ditolak (F-19)', async () => {
    await db.update(poLines).set({ openQty: 1 }).where(eq(poLines.partId, partA));
    const before = await db.select({ value: count() }).from(picklistHeaders)
      .where(eq(picklistHeaders.vendorId, vendorId));
    await expect(svc.issueManual(
      { vendorId, deliveryDate: '2026-09-25', lines: [{ vendorPartId: vpA, boxes: 1 }] },
      actor,
    )).rejects.toSatisfy((error: unknown) =>
      error instanceof UnprocessableEntityException
      && String((error as Error).message).includes('PO_OPEN_QTY'));
    await db.update(poLines).set({ openQty: 1_000_000 }).where(eq(poLines.partId, partA));
    const after = await db.select({ value: count() }).from(picklistHeaders)
      .where(eq(picklistHeaders.vendorId, vendorId));
    expect(Number(after[0]?.value)).toBe(Number(before[0]?.value));
  });
});

describe('PicklistService.issueAutomatic (F-16, F-18, 6.1–6.2)', () => {
  it('DAY dan ETA jadwal receiving menentukan tanggal picklist otomatis', async () => {
    await db.update(vendors).set({ deliveryDays: '5' }).where(eq(vendors.id, vendorId));
    const cutoffAt = new Date('2026-06-08T03:00:00Z'); // Senin; lead time minimum Selasa.
    await db.insert(orderQueues).values({ vendorPartId: vpA, cutoffAt, pcs: 100 });

    const result = await svc.issueAutomatic(vendorId, cutoffAt, actor);
    expect(result.status).toBe('CREATED');
    if (result.status !== 'CREATED') throw new Error('Picklist otomatis tidak terbit');
    const detail = await svc.get(result.id, null);
    expect(detail).toMatchObject({
      type: 'AUTO',
      deliveryDate: '2026-06-12',
      arrivalTime: '14:00:00',
    });

    await db.update(vendors).set({ deliveryDays: null }).where(eq(vendors.id, vendorId));
  });

  it('dua antrean satu cutoff → satu picklist; sisa diteruskan; retry idempoten', async () => {
    const [po] = await db
      .select({ id: poHeaders.id })
      .from(poHeaders)
      .where(eq(poHeaders.vendorId, vendorId))
      .limit(1);
    await db.insert(poLines).values({
      poId: po!.id,
      item: '00020',
      partId: partB,
      openQty: 1_000_000,
      syncedAt: new Date(),
    });

    const cutoffAt = new Date('2026-06-01T03:00:00Z'); // 10.00 Asia/Jakarta
    await db.insert(orderQueues).values([
      { vendorPartId: vpA, cutoffAt, pcs: 250 },
      { vendorPartId: vpB, cutoffAt, pcs: 100 },
    ]);

    const first = await svc.issueAutomatic(vendorId, cutoffAt, actor);
    expect(first).toMatchObject({
      status: 'CREATED',
      lineCount: 2,
      kanbanCount: 4,
      queueCount: 2,
    });
    if (first.status !== 'CREATED') throw new Error('Picklist otomatis tidak terbit');
    const detail = await svc.get(first.id, null);
    expect(detail).toMatchObject({
      type: 'AUTO',
      status: 'ISSUED',
      deliveryDate: '2026-06-02',
    });
    expect(detail.lines.map((line) => line.boxOrdered).sort((a, b) => a - b)).toEqual([2, 2]);

    const cutoffRows = await db
      .select()
      .from(orderQueues)
      .where(inArray(orderQueues.vendorPartId, [vpA, vpB]));
    const originalQueues = cutoffRows.filter((row) => row.cutoffAt.getTime() === cutoffAt.getTime());
    expect(originalQueues).toHaveLength(2);
    expect(originalQueues.every((row) => row.status === 'CLOSED')).toBe(true);
    expect(
      cutoffRows.find(
        (row) => row.vendorPartId === vpA && row.status === 'OPEN' && row.cutoffAt > cutoffAt,
      ),
    ).toMatchObject({ pcs: 0, carryOverPcs: 50 });

    const second = await svc.issueAutomatic(vendorId, cutoffAt, actor);
    expect(second.status).toBe('SKIPPED');
    const [autoCount] = await db
      .select({ value: count() })
      .from(picklistHeaders)
      .where(
        and(
          eq(picklistHeaders.vendorId, vendorId),
          eq(picklistHeaders.cutoffAt, cutoffAt),
          eq(picklistHeaders.type, 'AUTO'),
        ),
      );
    expect(Number(autoCount?.value)).toBe(1);
  });

  it('PO tidak tersedia → antrean tetap OPEN dan ditandai blocked', async () => {
    const noPoPart = (
      await db
        .insert(parts)
        .values({ sapMaterialNo: `TC-${stamp}`, partNo: `TC-${stamp}`, name: 'Part tanpa PO' })
        .$returningId()
    )[0]!.id;
    const noPoVp = (
      await db
        .insert(vendorParts)
        .values({ partId: noPoPart, vendorId, qtyPerBox: 10, backNo: 'C-1' })
        .$returningId()
    )[0]!.id;
    const cutoffAt = new Date('2026-06-03T03:00:00Z');
    await db.insert(orderQueues).values({ vendorPartId: noPoVp, cutoffAt, pcs: 20 });

    const result = await svc.issueAutomatic(vendorId, cutoffAt, actor);
    expect(result).toMatchObject({ status: 'BLOCKED', queueCount: 1 });
    const [queue] = await db
      .select()
      .from(orderQueues)
      .where(and(eq(orderQueues.vendorPartId, noPoVp), eq(orderQueues.cutoffAt, cutoffAt)));
    expect(queue).toMatchObject({ status: 'OPEN' });
    expect(queue?.blockedReason).toContain(`TC-${stamp}`);

    await db.delete(auditLogs).where(and(
      eq(auditLogs.entity, 'TT_ORDER_QUEUE'),
      eq(auditLogs.entityId, String(queue!.id)),
    ));
    await db.delete(orderQueues).where(eq(orderQueues.id, queue!.id));
    await db.delete(vendorParts).where(eq(vendorParts.id, noPoVp));
    await db.delete(parts).where(eq(parts.id, noPoPart));
  });

  it('OPEN_QTY tidak cukup → antrean cutoff tetap OPEN dengan alasan PO_OPEN_QTY (F-19)', async () => {
    await db.update(poLines).set({ openQty: 1 }).where(eq(poLines.partId, partA));
    const cutoffAt = new Date('2026-06-04T03:00:00Z');
    await db.insert(orderQueues).values({ vendorPartId: vpA, cutoffAt, pcs: 100 });
    const result = await svc.issueAutomatic(vendorId, cutoffAt, actor);
    expect(result).toMatchObject({ status: 'BLOCKED', queueCount: 1 });
    const [queueRow] = await db.select().from(orderQueues).where(and(
      eq(orderQueues.vendorPartId, vpA), eq(orderQueues.cutoffAt, cutoffAt),
    ));
    expect(queueRow).toMatchObject({ status: 'OPEN' });
    expect(queueRow?.blockedReason).toMatch(/^PO_OPEN_QTY/);
    await db.update(poLines).set({ openQty: 1_000_000 }).where(eq(poLines.partId, partA));
  });
});

describe('PicklistService.cancel (F-20, 6.6.2, 6.6.3)', () => {
  it('ISSUED → CANCELLED, kanban PRINTED ikut CANCELLED, alasan tercatat', async () => {
    const issued = await svc.issueManual(
      { vendorId, deliveryDate: '2026-09-25', lines: [{ vendorPartId: vpA, boxes: 2 }] },
      actor,
    );
    const out = await svc.cancel(issued.id, 'Salah supplier', actor, null);
    expect(out).toEqual({ id: issued.id, status: 'CANCELLED', kanbanCount: 2 });

    const detail = await svc.get(issued.id, null);
    expect(detail.status).toBe('CANCELLED');
    expect(detail.note).toContain('Salah supplier');
    expect(detail.lines[0]?.status).toBe('CANCELLED');
    expect(detail.lines[0]!.kanbans.every((k) => k.status === 'CANCELLED')).toBe(true);

    const evs = await db
      .select({ type: kanbanEvents.type })
      .from(kanbanEvents)
      .where(
        inArray(
          kanbanEvents.kanbanId,
          detail.lines[0]!.kanbans.map((k) => k.id),
        ),
      );
    expect(evs.filter((e) => e.type === 'CANCELLED')).toHaveLength(2);
    const audit = await db.select({ action: auditLogs.action }).from(auditLogs)
      .where(and(eq(auditLogs.entity, 'TT_PICKLIST_H'), eq(auditLogs.entityId, String(issued.id))))
      .orderBy(asc(auditLogs.id));
    expect(audit.map((row) => row.action)).toEqual(['ISSUE', 'CANCEL']);
  });

  it('sudah CANCELLED tidak bisa dibatalkan lagi; nomor tidak dipakai ulang', async () => {
    const issued = await svc.issueManual(
      { vendorId, deliveryDate: '2026-09-25', lines: [{ vendorPartId: vpA, boxes: 1 }] },
      actor,
    );
    await svc.cancel(issued.id, 'uji', actor, null);
    await expect(svc.cancel(issued.id, 'lagi', actor, null)).rejects.toBeInstanceOf(
      ConflictException,
    );

    const next = await svc.issueManual(
      { vendorId, deliveryDate: '2026-09-25', lines: [{ vendorPartId: vpA, boxes: 1 }] },
      actor,
    );
    expect(next.picklistNo).not.toBe(issued.picklistNo);
  });
});

describe('PicklistService.list', () => {
  it('menyaring per vendor dan status, membawa nama supplier dan ringkasan box', async () => {
    const res = await svc.list(
      { page: 1, perPage: 5, dir: 'asc', vendorId, status: 'ISSUED' },
      null,
    );
    expect(res.meta.total).toBeGreaterThan(0);
    expect(res.data.every((r) => r.vendorId === vendorId && r.status === 'ISSUED')).toBe(true);
    expect(res.data[0]).toMatchObject({ vendorName: 'Supplier uji', lineCount: 1 });
    expect(res.data[0]!.boxOrdered).toBeGreaterThan(0);
  });
});

describe('scope vendor (aturan repo 9)', () => {
  /*
   * Supplier lain diwakili id vendor yang pasti bukan milik data uji ini.
   * Yang diuji bukan "UI menyembunyikan", melainkan service menolak walau
   * id-nya ditebak dengan benar.
   */
  const vendorLain = () => vendorId + 100000;

  it('detail picklist vendor lain → NotFound, bukan 403 yang mengonfirmasi id', async () => {
    const issued = await svc.issueManual(
      { vendorId, deliveryDate: '2026-09-25', lines: [{ vendorPartId: vpA, boxes: 1 }] },
      actor,
    );
    await expect(svc.get(issued.id, vendorLain())).rejects.toBeInstanceOf(NotFoundException);
    // Pemiliknya sendiri tetap bisa membuka.
    await expect(svc.get(issued.id, vendorId)).resolves.toMatchObject({ id: issued.id });
  });

  it('daftar tidak pernah melebar walau vendorId di query string diisi vendor lain', async () => {
    const res = await svc.list({ page: 1, perPage: 50, dir: 'asc', vendorId }, vendorLain());
    expect(res.data).toHaveLength(0);
  });

  it('pembatalan lintas vendor tidak mengubah apa pun', async () => {
    const issued = await svc.issueManual(
      { vendorId, deliveryDate: '2026-09-25', lines: [{ vendorPartId: vpA, boxes: 1 }] },
      actor,
    );
    await expect(svc.cancel(issued.id, 'coba', actor, vendorLain())).rejects.toBeInstanceOf(
      NotFoundException,
    );
    const tetap = await svc.get(issued.id, null);
    expect(tetap.status).toBe('ISSUED');
  });

  it('markDownloaded hanya berlaku sekali dan hanya untuk pemiliknya (F-29)', async () => {
    const issued = await svc.issueManual(
      { vendorId, deliveryDate: '2026-09-25', lines: [{ vendorPartId: vpA, boxes: 1 }] },
      actor,
    );

    await svc.markDownloaded(issued.id, vendorLain());
    expect((await svc.get(issued.id, null)).status).toBe('ISSUED');

    await svc.markDownloaded(issued.id, vendorId);
    const pertama = await svc.get(issued.id, null);
    expect(pertama.status).toBe('DOWNLOADED');
    expect(pertama.downloadedAt).toBeInstanceOf(Date);

    // Unduhan kedua (PDF kanban menyusul beberapa detik kemudian) tidak boleh
    // menggeser waktu unduh pertama.
    await svc.markDownloaded(issued.id, vendorId);
    const kedua = await svc.get(issued.id, null);
    expect(kedua.downloadedAt?.getTime()).toBe(pertama.downloadedAt?.getTime());
  });
});

describe('scope pabrik', () => {
  it('ID benar tetap tidak bisa dibaca, didaftar, atau dibatalkan dari pabrik lain', async () => {
    const issued = await svc.issueManual(
      { vendorId, deliveryDate: '2026-09-25', lines: [{ vendorPartId: vpA, boxes: 1 }] },
      actor,
    );
    const plantLain = actor.plantId + 100000;
    await expect(svc.get(issued.id, null, plantLain)).rejects.toBeInstanceOf(NotFoundException);
    const list = await svc.list({ page: 1, perPage: 50, dir: 'asc', vendorId }, null, plantLain);
    expect(list.data).toHaveLength(0);
    await expect(svc.cancel(issued.id, 'lintas pabrik', { ...actor, plantId: plantLain }, null))
      .rejects.toBeInstanceOf(NotFoundException);
    expect((await svc.get(issued.id, null, actor.plantId)).status).toBe('ISSUED');
  });
});

describe('PicklistService.confirmShipment (F-30, 6.3, F-25)', () => {
  const setPolicy = (policy: 'CARRY_OVER' | 'REVISION') =>
    db
      .update(vendorCutoffs)
      .set({ shortShipPolicy: policy })
      .where(eq(vendorCutoffs.vendorId, vendorId));

  const kanbanRows = (picklistId: number) =>
    db
      .select({
        id: kanbans.id,
        serial: kanbans.serial,
        status: kanbans.status,
        picklistLineId: kanbans.picklistLineId,
      })
      .from(kanbans)
      .innerJoin(picklistLines, eq(kanbans.picklistLineId, picklistLines.id))
      .where(eq(picklistLines.picklistId, picklistId))
      .orderBy(asc(kanbans.serial));

  it('konfirmasi penuh → SHIPPED, ETA & kendaraan tersimpan, semua kanban SHIPPED + event', async () => {
    await setPolicy('CARRY_OVER');
    const issued = await svc.issueManual(
      { vendorId, deliveryDate: '2026-09-25', lines: [{ vendorPartId: vpA, boxes: 2 }] },
      actor,
    );
    const detail = await svc.get(issued.id, null);
    const lineId = detail.lines[0]!.id;

    const out = await svc.confirmShipment(
      issued.id,
      {
        lines: [{ picklistLineId: lineId, boxShipped: 2 }],
        eta: '2026-09-25T06:30:00.000Z',
        vehicleNo: 'B 1234 XYZ',
        note: 'Sopir Budi',
      },
      { vendorId, userId: actor.userId },
    );
    expect(out).toMatchObject({
      status: 'SHIPPED',
      short: false,
      policy: 'REVISION',
      revision: null,
    });
    expect(out.lines).toEqual([
      { picklistLineId: lineId, boxShipped: 2, boxShort: 0, status: 'OPEN' },
    ]);

    const after = await svc.get(issued.id, null);
    expect(after.status).toBe('SHIPPED');
    expect(after.shippedAt).toBeInstanceOf(Date);
    expect(after.eta?.toISOString()).toBe('2026-09-25T06:30:00.000Z');
    expect(after.vehicleNo).toBe('B 1234 XYZ');
    expect(after.note).toContain('Supplier: Sopir Budi');
    expect(after.lines[0]).toMatchObject({ boxShipped: 2, status: 'OPEN' });
    expect(after.lines[0]!.kanbans.map((k) => k.status)).toEqual(['SHIPPED', 'SHIPPED']);

    const evs = await db
      .select({ type: kanbanEvents.type })
      .from(kanbanEvents)
      .where(
        inArray(
          kanbanEvents.kanbanId,
          after.lines[0]!.kanbans.map((k) => k.id),
        ),
      );
    expect(evs.filter((e) => e.type === 'SHIPPED')).toHaveLength(2);
    const audit = await db.select({ action: auditLogs.action }).from(auditLogs)
      .where(and(eq(auditLogs.entity, 'TT_PICKLIST_H'), eq(auditLogs.entityId, String(issued.id))))
      .orderBy(asc(auditLogs.id));
    expect(audit.map((row) => row.action)).toEqual(['ISSUE', 'CONFIRM_SHIPMENT']);

    // 6.3.4: setelah SHIPPED tidak bisa diubah supplier
    await expect(
      svc.confirmShipment(
        issued.id,
        { lines: [{ picklistLineId: lineId, boxShipped: 1 }] },
        { vendorId, userId: actor.userId },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('kurang, kebijakan REVISION → revisi 1 (nomor sama) berisi line sisa, kanban sisa pindah dan tetap PRINTED', async () => {
    await setPolicy('REVISION');
    jobs.length = 0;
    // Hanya part A yang ber-PO di fixture ini (F-18), jadi satu line 3 box.
    const issued = await svc.issueManual(
      { vendorId, deliveryDate: '2026-09-25', lines: [{ vendorPartId: vpA, boxes: 3 }] },
      actor,
    );
    const detail = await svc.get(issued.id, null);
    const [lineA] = detail.lines;

    const out = await svc.confirmShipment(
      issued.id,
      { lines: [{ picklistLineId: lineA!.id, boxShipped: 1 }] },
      { vendorId, userId: actor.userId },
    );
    expect(out).toMatchObject({ status: 'SHIPPED', short: true, policy: 'REVISION' });
    expect(out.revision).toMatchObject({ revision: 1, lineCount: 1 });

    // rev 0: line A SHORT 1/3
    const rev0 = await svc.get(issued.id, null);
    expect(rev0.lines.map((l) => [l.boxShipped, l.status])).toEqual([[1, 'SHORT']]);
    // rev 1: nomor sama, ISSUED, satu line = sisa 2 box, PO diwarisi
    const rev1 = await svc.get(out.revision!.id, null);
    expect(rev1).toMatchObject({
      picklistNo: issued.picklistNo,
      revision: 1,
      status: 'ISSUED',
      deliveryDate: '2026-09-26',
    });
    expect(rev1.lines).toHaveLength(1);
    expect(rev1.lines[0]).toMatchObject({
      vendorPartId: vpA,
      boxOrdered: 2,
      pcs: 200,
      sapPoNo: lineA!.sapPoNo,
      sapPoItem: lineA!.sapPoItem,
    });

    // kanban: serial 1 SHIPPED tinggal di rev 0; serial 2–3 PRINTED pindah ke line rev 1
    const k0 = await kanbanRows(issued.id);
    expect(k0.map((k) => [k.serial, k.status])).toEqual([[1, 'SHIPPED']]);
    const k1 = await kanbanRows(out.revision!.id);
    expect(k1.map((k) => [k.serial, k.status, k.picklistLineId])).toEqual([
      [2, 'PRINTED', rev1.lines[0]!.id],
      [3, 'PRINTED', rev1.lines[0]!.id],
    ]);

    // revisi dirender & diberitahukan lewat antrean (F-27, F-31)
    expect(jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'render-pdf', payload: { picklistId: out.revision!.id } }),
        expect.objectContaining({
          name: 'send-notification',
          payload: { kind: 'PICKLIST_REVISED', picklistId: out.revision!.id },
        }),
      ]),
    );

    // Bila recovery pertama masih kurang, base order tetap dan RR naik menjadi 02.
    const out2 = await svc.confirmShipment(
      rev1.id,
      { lines: [{ picklistLineId: rev1.lines[0]!.id, boxShipped: 1 }] },
      { vendorId, userId: actor.userId },
    );
    expect(out2.revision).toMatchObject({ revision: 2, lineCount: 1 });
    const rev2 = await svc.get(out2.revision!.id, null);
    expect(rev2).toMatchObject({ picklistNo: issued.picklistNo, revision: 2, status: 'ISSUED' });
    expect(orderSheetDisplayNo(rev2.picklistNo, rev2.revision)).toBe(
      `${issued.picklistNo.slice(0, -2)}02`,
    );
  });

  it('setting lama CARRY_OVER diabaikan: kekurangan tetap menjadi recovery RR 01', async () => {
    await setPolicy('CARRY_OVER');
    const issued = await svc.issueManual(
      { vendorId, deliveryDate: '2026-09-25', lines: [{ vendorPartId: vpA, boxes: 3 }] },
      actor,
    );
    const lineId = (await svc.get(issued.id, null)).lines[0]!.id;

    const out = await svc.confirmShipment(
      issued.id,
      { lines: [{ picklistLineId: lineId, boxShipped: 2 }] },
      { vendorId, userId: actor.userId },
    );
    expect(out).toMatchObject({ short: true, policy: 'REVISION' });
    expect(out.revision).toMatchObject({ revision: 1, lineCount: 1 });
    expect(out.carryOver).toEqual([]);

    const after = await svc.get(issued.id, null);
    expect(after.lines[0]).toMatchObject({ boxShipped: 2, status: 'SHORT' });
    expect(after.lines[0]!.kanbans.map((k) => k.status)).toEqual(['SHIPPED', 'SHIPPED']);
    const [rev1] = await db
      .select({ id: picklistHeaders.id, revision: picklistHeaders.revision })
      .from(picklistHeaders)
      .where(
        and(eq(picklistHeaders.picklistNo, issued.picklistNo), eq(picklistHeaders.revision, 1)),
      );
    expect(rev1).toMatchObject({ revision: 1 });
    const recovery = await svc.get(rev1!.id, null);
    expect(recovery.lines[0]).toMatchObject({ boxOrdered: 1 });
    expect(orderSheetDisplayNo(recovery.picklistNo, recovery.revision)).toBe(
      `${issued.picklistNo.slice(0, -2)}01`,
    );
  });

  it('melebihi order → 422; vendor lain → 404; line tidak lengkap → 422', async () => {
    const issued = await svc.issueManual(
      { vendorId, deliveryDate: '2026-09-25', lines: [{ vendorPartId: vpA, boxes: 1 }] },
      actor,
    );
    const lineId = (await svc.get(issued.id, null)).lines[0]!.id;
    await expect(
      svc.confirmShipment(
        issued.id,
        { lines: [{ picklistLineId: lineId, boxShipped: 2 }] },
        { vendorId, userId: actor.userId },
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(
      svc.confirmShipment(
        issued.id,
        { lines: [{ picklistLineId: lineId, boxShipped: 1 }] },
        { vendorId: vendorId + 999, userId: actor.userId },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      svc.confirmShipment(
        issued.id,
        { lines: [{ picklistLineId: 999999, boxShipped: 1 }] },
        { vendorId, userId: actor.userId },
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    // masih ISSUED — tidak ada yang berubah
    expect((await svc.get(issued.id, null)).status).toBe('ISSUED');
  });
});

describe('PicklistService.overrideShipment (6.3.4)', () => {
  it('PPIC mengoreksi BOX_SHIPPED dengan alasan, lalu perubahan terkunci setelah sesi scan dibuka', async () => {
    await db.update(vendorCutoffs).set({ shortShipPolicy: 'CARRY_OVER' })
      .where(eq(vendorCutoffs.vendorId, vendorId));
    const issued = await svc.issueManual(
      { vendorId, deliveryDate: '2026-09-25', lines: [{ vendorPartId: vpA, boxes: 3 }] },
      actor,
    );
    const lineId = (await svc.get(issued.id, null)).lines[0]!.id;
    await svc.confirmShipment(
      issued.id,
      { lines: [{ picklistLineId: lineId, boxShipped: 3 }] },
      { vendorId, userId: actor.userId },
    );

    const result = await svc.overrideShipment(issued.id, {
      reason: 'Satu box rusak sebelum truk berangkat',
      lines: [{ picklistLineId: lineId, boxShipped: 2 }],
    }, actor);
    expect(result).toMatchObject({ id: issued.id, status: 'SHIPPED' });
    expect(result.revision).toMatchObject({ revision: 1, lineCount: 1 });
    const after = await svc.get(issued.id, null);
    expect(after.lines[0]).toMatchObject({ boxShipped: 2, status: 'SHORT' });
    expect(after.lines[0]!.kanbans.map((row) => row.status)).toEqual(['SHIPPED', 'SHIPPED']);
    const recovery = await svc.get(result.revision!.id, null);
    expect(recovery).toMatchObject({ picklistNo: issued.picklistNo, revision: 1 });
    expect(recovery.lines[0]).toMatchObject({ boxOrdered: 1 });
    expect(recovery.lines[0]!.kanbans.map((row) => row.status)).toEqual(['PRINTED']);
    expect(orderSheetDisplayNo(recovery.picklistNo, recovery.revision)).toBe(
      `${issued.picklistNo.slice(0, -2)}01`,
    );
    const audit = await db.select({ action: auditLogs.action, after: auditLogs.after })
      .from(auditLogs).where(and(
        eq(auditLogs.entity, 'TT_PICKLIST_H'),
        eq(auditLogs.entityId, String(issued.id)),
        eq(auditLogs.action, 'OVERRIDE_SHIPMENT'),
      ));
    expect(audit).toHaveLength(1);
    expect(audit[0]!.after).toMatchObject({ reason: 'Satu box rusak sebelum truk berangkat' });

    const receiptId = (await db.insert(receiptHeaders).values({
      plantId: actor.plantId,
      receiptNo: `TEST-OVERRIDE-${stamp}`,
      picklistId: issued.id,
      status: 'OPEN',
    }).$returningId())[0]!.id;
    await expect(svc.overrideShipment(issued.id, {
      reason: 'Coba setelah scan dibuka',
      lines: [{ picklistLineId: lineId, boxShipped: 1 }],
    }, actor)).rejects.toBeInstanceOf(ConflictException);
    await db.delete(receiptHeaders).where(eq(receiptHeaders.id, receiptId));
  });
});
