import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
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
  kanbans,
  kanbanEvents,
  auditLogs,
} from '@ares/db';
import { parseScanCode } from '@ares/domain';
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
let vendorId: number;
let partA: number;
let partB: number;
let vpA: number;
let vpB: number;

beforeAll(async () => {
  // Pabrik dan user dari seed (pnpm db:seed); CREATED_BY_ID / USER_ID adalah FK ke TM_USER.
  const [plant] = await db.select({ id: plants.id }).from(plants).limit(1);
  const [user] = await db.select({ id: users.id }).from(users).limit(1);
  if (!plant || !user)
    throw new Error('Jalankan `pnpm db:seed` dulu: butuh satu pabrik dan satu user');
  actor = { userId: user.id, plantId: plant.id };

  vendorId = (
    await db
      .insert(vendors)
      .values({ sapVendorNo: `T${stamp}`, name: 'Supplier uji' })
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
    .values({ poId, item: '00010', partId: partA, openQty: 1000, syncedAt: new Date() });
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

    expect(out.picklistNo).toMatch(/^PL-\d{6}-\d{4}$/);
    expect(out).toMatchObject({ revision: 0, lineCount: 1, kanbanCount: 3 });
    // Nomor harus terbaca kembali sebagai barcode picklist (8.3).
    expect(parseScanCode(`ARES:P:${out.picklistNo}-0`)).toEqual({
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

  it('nomor berurutan per hari dan serial kanban urut lintas line', async () => {
    const a = await svc.issueManual(
      { vendorId, deliveryDate: '2026-09-25', lines: [{ vendorPartId: vpA, boxes: 1 }] },
      actor,
    );
    const b = await svc.issueManual(
      { vendorId, deliveryDate: '2026-09-25', lines: [{ vendorPartId: vpA, boxes: 2 }] },
      actor,
    );
    expect(Number(b.picklistNo.slice(-4))).toBe(Number(a.picklistNo.slice(-4)) + 1);
    expect(b.picklistNo.slice(0, -4)).toBe(a.picklistNo.slice(0, -4));
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
      policy: 'CARRY_OVER',
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
  });

  it('kurang, kebijakan CARRY_OVER → kanban sisa CANCELLED, line SHORT, tanpa revisi', async () => {
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
    expect(out).toMatchObject({ short: true, policy: 'CARRY_OVER', revision: null });

    const after = await svc.get(issued.id, null);
    expect(after.lines[0]).toMatchObject({ boxShipped: 2, status: 'SHORT' });
    expect(after.lines[0]!.kanbans.map((k) => k.status)).toEqual([
      'SHIPPED',
      'SHIPPED',
      'CANCELLED',
    ]);
    const [rev1] = await db
      .select({ id: picklistHeaders.id })
      .from(picklistHeaders)
      .where(
        and(eq(picklistHeaders.picklistNo, issued.picklistNo), eq(picklistHeaders.revision, 1)),
      );
    expect(rev1).toBeUndefined();
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
