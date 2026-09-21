import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  getDb,
  closeDb,
  eq,
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
const jobs: Array<{ queue: string; name: string }> = [];
const queue = {
  add: async (queueName: string, jobName: string) => {
    jobs.push({ queue: queueName, name: jobName });
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
  });

  it('sudah CANCELLED tidak bisa dibatalkan lagi; nomor tidak dipakai ulang', async () => {
    const issued = await svc.issueManual(
      { vendorId, deliveryDate: '2026-09-25', lines: [{ vendorPartId: vpA, boxes: 1 }] },
      actor,
    );
    await svc.cancel(issued.id, 'uji', actor, null);
    await expect(svc.cancel(issued.id, 'lagi', actor, null)).rejects.toBeInstanceOf(ConflictException);

    const next = await svc.issueManual(
      { vendorId, deliveryDate: '2026-09-25', lines: [{ vendorPartId: vpA, boxes: 1 }] },
      actor,
    );
    expect(next.picklistNo).not.toBe(issued.picklistNo);
  });
});

describe('PicklistService.list', () => {
  it('menyaring per vendor dan status, membawa nama supplier dan ringkasan box', async () => {
    const res = await svc.list({ page: 1, perPage: 5, dir: 'asc', vendorId, status: 'ISSUED' }, null);
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
