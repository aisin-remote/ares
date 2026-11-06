import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  getDb, closeDb, eq, and, gt, desc, sql, inArray, vendors, parts, plants, users, vendorParts, vendorCutoffs, poHeaders, poLines,
  picklistHeaders, picklistLines, kanbans, kanbanEvents, auditLogs, settings,
} from '@ares/db';
import type { SapPoRow } from '@ares/domain';
import { SapPoService } from './sap-po.service';
import type { SapPoGateway } from './sap-po.gateway';
import type { QueueService } from '../queue/queue.service';
import { PicklistService } from '../picklist/picklist.service';
import { SequenceService } from '../common/sequence.service';
import { NotifyService } from '../notify/notify.service';
import { SapController } from './sap.controller';
import { PERMISSION_KEY } from '../auth/permissions.guard';

const db = getDb();
const readMonth = vi.fn();
const queue = { add: vi.fn().mockResolvedValue('test') } as unknown as QueueService;
const service = new SapPoService(db, { readMonth } as unknown as SapPoGateway, queue);
const stamp = Date.now().toString().slice(-10);
let vendorId: number, partId: number, vpId: number;
let actor: { userId: number; plantId: number };
const source: SapPoRow = {
  poNo: `SP${stamp}`, vendorNo: `SV${stamp}`, createdDate: '20261022', status: '9',
  headerDeleted: '0', closed: '', error: '', item: 10, material: `SM${stamp}`,
  quantity: '10.000', uom: 'PC', plant: '700', lineDeleted: '',
};

beforeAll(async () => {
  vi.stubEnv('STAGING_PULL_ENABLED', 'true');
  const [plant] = await db.select().from(plants).limit(1);
  const [user] = await db.select().from(users).limit(1);
  actor = { plantId: plant!.id, userId: user!.id };
  vendorId = (await db.insert(vendors).values({ sapVendorNo: source.vendorNo!, name: 'Uji tarik PO', plantId: actor.plantId }).$returningId())[0]!.id;
  partId = (await db.insert(parts).values({ sapMaterialNo: source.material!, partNo: source.material!, name: 'Uji part PO' }).$returningId())[0]!.id;
  vpId = (await db.insert(vendorParts).values({ vendorId, partId, qtyPerBox: 1, backNo: 'PO-T' }).$returningId())[0]!.id;
  await db.insert(vendorCutoffs).values({ vendorId, arrivalTime: '14:00:00' });
});
afterAll(async () => {
  vi.unstubAllEnvs();
  if (vendorId) {
    const pls = (await db.select({ id: picklistHeaders.id }).from(picklistHeaders).where(eq(picklistHeaders.vendorId, vendorId))).map((p) => p.id);
    if (pls.length) {
      await db.delete(auditLogs).where(and(eq(auditLogs.entity, 'TT_PICKLIST_H'), inArray(auditLogs.entityId, pls.map(String))));
      const lineIds = (await db.select({ id: picklistLines.id }).from(picklistLines).where(inArray(picklistLines.picklistId, pls))).map((l) => l.id);
      const kIds = lineIds.length ? (await db.select({ id: kanbans.id }).from(kanbans).where(inArray(kanbans.picklistLineId, lineIds))).map((k) => k.id) : [];
      if (kIds.length) {
        await db.delete(kanbanEvents).where(inArray(kanbanEvents.kanbanId, kIds));
        await db.delete(kanbans).where(inArray(kanbans.id, kIds));
      }
      await db.delete(picklistHeaders).where(inArray(picklistHeaders.id, pls));
    }
    await db.delete(poHeaders).where(eq(poHeaders.vendorId, vendorId));
    await db.delete(vendorParts).where(eq(vendorParts.vendorId, vendorId));
    await db.delete(vendors).where(eq(vendors.id, vendorId));
  }
  if (partId) await db.delete(parts).where(eq(parts.id, partId));
  await closeDb();
});

describe('tarik PO SAP ke cache ARES', () => {
  it('pratinjau tidak menulis; sinkron ulang tidak menggandakan; PO Oktober berlaku November', async () => {
    readMonth.mockResolvedValue([source]);
    expect(await service.sync('2026-11', true)).toMatchObject({ imported: 1, failed: 0, preview: true });
    // Order November memakai PO yang dibuat SAP bulan Oktober.
    expect(readMonth).toHaveBeenLastCalledWith('2026-10');
    expect(await db.select().from(poHeaders).where(eq(poHeaders.sapPoNo, source.poNo))).toHaveLength(0);
    expect(await service.sync('2026-11')).toMatchObject({ imported: 1, failed: 0 });
    expect(await service.sync('2026-11')).toMatchObject({ imported: 1, failed: 0 });
    const headers = await db.select().from(poHeaders).where(eq(poHeaders.sapPoNo, source.poNo));
    expect(headers).toHaveLength(1);
    expect(headers[0]).toMatchObject({ source: 'SAP', validFrom: '2026-11-01', validTo: '2026-11-30' });
    const lines = await db.select().from(poLines).where(eq(poLines.poId, headers[0]!.id));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ item: '00010', orderedQty: 10, openQty: 10, balanceVerified: true, sapPlantNo: '700' });
  });
  it('sisa PO = qty PO − pesanan ARES; pesanan melebihi sisa ditolak (F-19)', async () => {
    const picklist = new PicklistService(db, new SequenceService(), queue, new NotifyService(db, queue));
    await picklist.issueManual({ vendorId, deliveryDate: '2026-11-22', lines: [{ vendorPartId: vpId, boxes: 4 }] }, actor);
    await expect(picklist.issueManual({ vendorId, deliveryDate: '2026-11-23', lines: [{ vendorPartId: vpId, boxes: 7 }] }, actor))
      .rejects.toThrow(/sudah dipesan 4 \+ baru 7 > qty PO 10 \(sisa 6\)/);
    await expect(picklist.issueManual({ vendorId, deliveryDate: '2026-11-23', lines: [{ vendorPartId: vpId, boxes: 6 }] }, actor))
      .resolves.toMatchObject({ picklistNo: expect.any(String) });
    // Tanggal kirim Desember tidak boleh memakai PO November.
    await expect(picklist.issueManual({ vendorId, deliveryDate: '2026-12-01', lines: [{ vendorPartId: vpId, boxes: 1 }] }, actor))
      .rejects.toThrow('Tidak ada PO');
  });
  it('menolak PO utuh jika satu item tidak cocok dan tidak menimpa referensi historis', async () => {
    readMonth.mockResolvedValue([{ ...source, quantity: '20.000' }, { ...source, item: 20, material: 'NOT-MAPPED' }]);
    expect(await service.sync('2026-11')).toMatchObject({ imported: 0, failed: 2 });
    const [header] = await db.select().from(poHeaders).where(eq(poHeaders.sapPoNo, source.poNo));
    const [line] = await db.select().from(poLines).where(eq(poLines.poId, header!.id));
    expect(line!.orderedQty).toBe(10);
    readMonth.mockResolvedValue([{ ...source, plant: '600' }]);
    expect(await service.sync('2026-11')).toMatchObject({ imported: 0, failed: 1 });
  });
  it('saldo dinonaktifkan pada PO yang ditutup dan bulan kosong tidak menghapus bulan lain', async () => {
    readMonth.mockResolvedValue([{ ...source, closed: 'X' }]);
    expect(await service.sync('2026-11')).toMatchObject({ imported: 1, failed: 0 });
    const [header] = await db.select().from(poHeaders).where(eq(poHeaders.sapPoNo, source.poNo));
    const [line] = await db.select().from(poLines).where(eq(poLines.poId, header!.id));
    expect(line).toMatchObject({ isActive: false, openQty: 0 });
    readMonth.mockResolvedValue([]);
    expect(await service.sync('2026-12')).toMatchObject({ fetched: 0, imported: 0 });
    expect((await service.status('2026-11')).count).toBe(1);
  });
  it('jadwal: tarik hanya pada tanggal tarik untuk bulan berikutnya; tanggal dapat diubah dan teraudit', async () => {
    readMonth.mockClear(); readMonth.mockResolvedValue([]);
    const before = await service.pullDay();
    const [{ maxId } = { maxId: 0 }] = await db.select({ maxId: sql<number>`coalesce(max(${auditLogs.id}), 0)` }).from(auditLogs);
    try {
      await service.setPullDay(20, actor.userId);
      expect(await service.pullDay()).toBe(20);
      expect(await service.runScheduled(new Date('2026-10-24T01:00:00Z'))).toEqual({ skipped: 'Bukan tanggal tarik PO' });
      expect(readMonth).not.toHaveBeenCalled();
      expect(await service.runScheduled(new Date('2026-10-20T01:00:00Z'))).toMatchObject({ month: '2026-11', fetched: 0 });
      expect(readMonth).toHaveBeenLastCalledWith('2026-10');
      const [audit] = await db.select().from(auditLogs).where(and(eq(auditLogs.entity, 'TM_SETTING'), eq(auditLogs.entityId, 'PO_PULL_DAY')))
        .orderBy(desc(auditLogs.id)).limit(1);
      expect(audit).toBeTruthy();
    } finally {
      await db.update(settings).set({ value: String(before) }).where(eq(settings.key, 'PO_PULL_DAY'));
      await db.delete(auditLogs).where(and(eq(auditLogs.entity, 'TM_SETTING'), gt(auditLogs.id, maxId)));
    }
  });
  it('pull false memblokir impor namun mengizinkan pratinjau; permission sinkron khusus', async () => {
    vi.stubEnv('STAGING_PULL_ENABLED', 'false');
    readMonth.mockClear(); readMonth.mockResolvedValue([]);
    await expect(service.sync('2026-11')).rejects.toThrow('dinonaktifkan');
    expect(readMonth).not.toHaveBeenCalled();
    await expect(service.sync('2026-11', true)).resolves.toMatchObject({ preview: true });
    expect(Reflect.getMetadata(PERMISSION_KEY, SapController.prototype.syncPo)).toBe('sap.po.sync');
  });
});
