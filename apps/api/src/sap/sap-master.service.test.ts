import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getDb, closeDb, eq, and, inArray, like, vendors, parts, vendorParts, users, auditLogs } from '@ares/db';
import { SapMasterService } from './sap-master.service';
import type { SapMasterGateway } from './sap-master.gateway';
import type { QueueService } from '../queue/queue.service';
import { SapController } from './sap.controller';
import { PERMISSION_KEY } from '../auth/permissions.guard';

const db = getDb();
const read = vi.fn();
const queue = { add: vi.fn().mockResolvedValue('test') } as unknown as QueueService;
const service = new SapMasterService(db, { read } as unknown as SapMasterGateway, queue);
const stamp = Date.now().toString().slice(-8);
const V = `MV${stamp}`, M1 = `MM1${stamp}`, M2 = `MM2${stamp}`;
let userId: number;

const snapshot = (over: { vendorName?: string } = {}) => ({
  vendors: [
    { supplierId: `${V}  `, name: `${over.vendorName ?? 'SUPPLIER UJI MASTER'}  `, address: 'JL UJI ', deleted: ' ' },
    { supplierId: `X${stamp}`, name: 'TIDAK DIPAKAI', address: null, deleted: '' },
  ],
  parts: [
    { material: M1, name: 'PART SATU', uom: 'PC', partNoDash: `${M1}-D`, backNo: 'B1', boxType: 'BX', qtyPerBox: 10, deleted: '' },
    { material: M2, name: 'PART DUA', uom: 'PC', partNoDash: null, backNo: null, boxType: null, qtyPerBox: 0, deleted: '' },
  ],
  vendorParts: [{ supplierId: V, material: M1 }, { supplierId: V, material: M1 }, { supplierId: V, material: M2 }],
  kanbans: [{ material: M1, wcVendor: V, backNo: 'K1', boxType: null, qtyPerBox: 25, rack: 'R9', deleted: '' }],
});

beforeAll(async () => {
  vi.stubEnv('STAGING_PULL_ENABLED', 'true');
  userId = (await db.select({ id: users.id }).from(users).limit(1))[0]!.id;
});
afterAll(async () => {
  vi.unstubAllEnvs();
  const [vendor] = await db.select().from(vendors).where(eq(vendors.sapVendorNo, V));
  const partIds = (await db.select({ id: parts.id }).from(parts).where(inArray(parts.sapMaterialNo, [M1, M2]))).map((p) => p.id);
  if (vendor) await db.delete(vendorParts).where(eq(vendorParts.vendorId, vendor.id));
  await db.delete(auditLogs).where(and(like(auditLogs.action, 'SYNC_SAP'), eq(auditLogs.userId, userId),
    inArray(auditLogs.entity, ['TM_VENDOR', 'TM_PARTS', 'TM_VENDOR_PARTS'])));
  if (vendor) await db.delete(vendors).where(eq(vendors.id, vendor.id));
  if (partIds.length) await db.delete(parts).where(inArray(parts.id, partIds));
  await closeDb();
});

describe('tarik master SAP ke ARES (F-01, F-02)', () => {
  it('pratinjau tidak menulis; supplier yang tidak dipakai vendor part dilewati', async () => {
    read.mockResolvedValue(snapshot());
    const result = await service.sync(true, userId);
    expect(result).toMatchObject({
      preview: true,
      vendors: { created: 1, updated: 0 },
      parts: { created: 2 },
      vendorParts: { created: 1, skipped: 1 },
    });
    expect(await db.select().from(vendors).where(eq(vendors.sapVendorNo, V))).toHaveLength(0);
  });

  it('sinkron membuat master; kemasan dari kanban supplier; tanpa qty per box dilewati dengan alasan', async () => {
    read.mockResolvedValue(snapshot());
    const result = await service.sync(false, userId);
    expect(result.vendorParts).toEqual({ created: 1, existing: 0, skipped: 1 });
    expect(result.issues.some((i) => i.key.includes(M2) && /Qty per box/.test(i.reason))).toBe(true);
    const [vendor] = await db.select().from(vendors).where(eq(vendors.sapVendorNo, V));
    expect(vendor).toMatchObject({ name: 'SUPPLIER UJI MASTER', address: 'JL UJI', isActive: true, plantId: null });
    const [part] = await db.select().from(parts).where(eq(parts.sapMaterialNo, M1));
    expect(part).toMatchObject({ partNo: `${M1}-D`, name: 'PART SATU' });
    const [vp] = await db.select().from(vendorParts).where(eq(vendorParts.vendorId, vendor!.id));
    expect(vp).toMatchObject({ qtyPerBox: 25, backNo: 'K1', rack: 'R9', partId: part!.id });
  });

  it('sinkron ulang: nama ikut SAP, kemasan vendor part yang sudah ada tidak ditimpa', async () => {
    const [vendor] = await db.select().from(vendors).where(eq(vendors.sapVendorNo, V));
    await db.update(vendorParts).set({ qtyPerBox: 99, backNo: 'PPIC' }).where(eq(vendorParts.vendorId, vendor!.id));
    read.mockResolvedValue(snapshot({ vendorName: 'NAMA BARU' }));
    const result = await service.sync(false, userId);
    expect(result).toMatchObject({ vendors: { created: 0, updated: 1 }, parts: { created: 0, unchanged: 2 }, vendorParts: { existing: 1 } });
    const [after] = await db.select().from(vendors).where(eq(vendors.id, vendor!.id));
    expect(after!.name).toBe('NAMA BARU');
    const [vp] = await db.select().from(vendorParts).where(eq(vendorParts.vendorId, vendor!.id));
    expect(vp).toMatchObject({ qtyPerBox: 99, backNo: 'PPIC' });
  });

  it('pull false memblokir sinkron tapi pratinjau tetap boleh; permission khusus', async () => {
    vi.stubEnv('STAGING_PULL_ENABLED', 'false');
    await expect(service.sync(false, userId)).rejects.toThrow('dinonaktifkan');
    await expect(service.sync(true, userId)).resolves.toMatchObject({ preview: true });
    expect(Reflect.getMetadata(PERMISSION_KEY, SapController.prototype.syncMaster)).toBe('sap.master.sync');
    vi.stubEnv('STAGING_PULL_ENABLED', 'true');
  });
});
