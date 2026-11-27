import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ConflictException, ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { and, auditLogs, closeDb, eq, getDb, parts, users, vendorParts, vendors } from '@ares/db';
import type { SapKanbanMasterRow } from '@ares/contracts';
import { SapKanbanService } from './sap-kanban.service';
import type { StagingDbService } from './staging-db.service';
import { MasterService } from '../master/master.service';
import { SapController } from './sap.controller';
import { PERMISSION_KEY } from '../auth/permissions.guard';

const staging = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  queries: [] as Array<{ sql: string; params: Record<string, unknown> }>,
  inserts: 0, commits: 0,
}));
vi.mock('mssql', () => {
  const request = () => {
    const params: Record<string, unknown> = {};
    return {
      input(name: string, _type: unknown, value: unknown) { params[name] = value; return this; },
      async query(command: string) {
        staging.queries.push({ sql: command, params: { ...params } });
        if (command.includes('WITH pairs AS')) {
          return { recordset: staging.rows.filter((row) =>
            (!params.supplierId || row.supplierId === params.supplierId) &&
            (!params.material || row.material === params.material),
          ).map((row) => ({ ...row })) };
        }
        if (command.includes('INSERT INTO dbo.TM_KANBAN')) {
          const row = staging.rows.find((row) => row.supplierId === params.supplier && row.material === params.part)!;
          row.kanbanId = 601;
          row.qty = params.qty;
          staging.inserts++;
          return { recordset: [{ kanbanId: 601 }] };
        }
        if (command.includes('UPDATE dbo.TM_KANBAN')) {
          const row = staging.rows.find((row) => row.kanbanId === params.id)!;
          row.qty = params.qty;
          return { recordset: [], rowsAffected: [1] };
        }
        throw new Error('SQL pengujian tidak dikenal');
      },
    };
  };
  return {
    Int: 'int', VarChar: (length: number) => length,
    ISOLATION_LEVEL: { SERIALIZABLE: 4 },
    Transaction: class {
      snapshot: typeof staging.rows = [];
      async begin() { this.snapshot = structuredClone(staging.rows); }
      request = request;
      async commit() { staging.commits++; }
      async rollback() { staging.rows = this.snapshot; }
    },
  };
});

const db = getDb();
const service = new SapKanbanService({ connect: async () => ({ request: () => ({
  input() { return this; },
  query: async () => ({ recordset: structuredClone(staging.rows) }),
}) }) } as unknown as StagingDbService, db);
const stamp = Date.now().toString().slice(-6);
const supplierId = `K${stamp}`, material = `KM${stamp}`;
let userId: number;
let vendorId: number;
let partId: number;
const input = (qty: number, expectedQty: number | null = null, kanbanId: number | null = null) =>
  ({ supplierId, material, qty, expectedQty, kanbanId });

beforeAll(async () => {
  userId = (await db.select({ id: users.id }).from(users).limit(1))[0]!.id;
  vendorId = (await db.insert(vendors).values({ sapVendorNo: supplierId, name: 'Supplier uji kanban' }).$returningId())[0]!.id;
  partId = (await db.insert(parts).values({ sapMaterialNo: material, partNo: material, name: 'Part uji kanban' }).$returningId())[0]!.id;
  const source: Omit<SapKanbanMasterRow, 'blockedReason'> = {
    kanbanId: null, supplierId, supplierName: 'Supplier uji kanban', material,
    partNo: material, partName: 'Part uji kanban', uom: 'PC', backNo: 'BK1',
    plant: '700', slocTo: 'WH70', locations: 'WH70', boxType: 'BX', rack: 'R1', qty: null,
  };
  staging.rows = [source];
});
afterAll(async () => {
  vi.restoreAllMocks();
  await db.delete(auditLogs).where(and(eq(auditLogs.entity, 'SAP.TM_KANBAN'), eq(auditLogs.entityId, `${supplierId}/${material}`)));
  await db.delete(vendorParts).where(eq(vendorParts.vendorId, vendorId));
  await db.delete(parts).where(eq(parts.id, partId));
  await db.delete(vendors).where(eq(vendors.id, vendorId));
  await closeDb();
});

describe('master kanban staging', () => {
  it('membaca atribut sumber, mencari supplier, dan tidak membuat data saat membuka daftar', async () => {
    const list = await service.list(supplierId);
    expect(list).toMatchObject({ total: 1, page: 1, rows: [{ supplierId, backNo: 'BK1', qty: null, blockedReason: null }] });
    expect((await service.list('tidak ditemukan')).total).toBe(0);
    expect(staging.inserts).toBe(0);
  });

  it('membuat master dengan ID staging, atribut otomatis, dan mengisi cache order ARES', async () => {
    expect(await service.save(input(24), userId)).toEqual({ kanbanId: 601, qty: 24, localUpdated: true });
    expect(staging.inserts).toBe(1);
    const command = staging.queries.find((query) => query.sql.includes('INSERT INTO dbo.TM_KANBAN'))!;
    expect(command.sql).toContain("VALUES ('S'");
    expect(command.params).toMatchObject({ qty: 24, supplier: supplierId, part: material, back: 'BK1', plant: '700', sloc: 'WH70' });
    const [vp] = await db.select().from(vendorParts).where(eq(vendorParts.vendorId, vendorId));
    expect(vp).toMatchObject({ qtyPerBox: 24, backNo: 'BK1', rack: 'R1', boxType: 'BX' });
  });

  it('mengubah hanya qty master yang sudah ada, mencatat user, dan memperbarui kemasan order berikutnya', async () => {
    await service.save(input(40, 24, 601), userId);
    const command = staging.queries.find((query) => query.sql.includes('UPDATE dbo.TM_KANBAN'))!;
    expect(command.sql.split('WHERE')[0]!.trim()).toBe('UPDATE dbo.TM_KANBAN SET INT_QTY_PER_BOX = @qty');
    expect(staging.rows[0]).toMatchObject({ qty: 40, backNo: 'BK1', rack: 'R1' });
    const [vp] = await db.select().from(vendorParts).where(eq(vendorParts.vendorId, vendorId));
    expect(vp?.qtyPerBox).toBe(40);
    const audit = await db.select().from(auditLogs).where(and(eq(auditLogs.entity, 'SAP.TM_KANBAN'),
      eq(auditLogs.entityId, `${supplierId}/${material}`), eq(auditLogs.action, 'STAGING_KANBAN_QTY')));
    expect(audit.some((row) => row.userId === userId && (row.after as { qty: number }).qty === 40)).toBe(true);
  });

  it('menolak qty tidak valid, sumber yang tidak tersedia, serta perubahan bersamaan', async () => {
    for (const qty of [0, -1, 1.5, 2_147_483_648]) {
      await expect(service.save(input(qty, 40, 601), userId)).rejects.toBeInstanceOf(UnprocessableEntityException);
    }
    await expect(service.save({ ...input(50, 40, 601), material: 'UNKNOWN' }, userId)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.save(input(50, 24, 601), userId)).rejects.toBeInstanceOf(ConflictException);
    expect(staging.rows[0]!.qty).toBe(40);
  });

  it('retry setelah commit staging tetap memakai master yang sama dan menyelaraskan cache', async () => {
    vi.spyOn(db, 'transaction').mockRejectedValueOnce(new Error('MySQL sementara tidak tersedia'));
    await expect(service.save(input(45, 40, 601), userId)).rejects.toThrow('Qty tersimpan di staging');
    expect(staging.rows[0]!.qty).toBe(45);
    expect(await service.save(input(45, 40, 601), userId)).toMatchObject({ qty: 45, localUpdated: true });
    expect(staging.inserts).toBe(1);
    const [vp] = await db.select().from(vendorParts).where(eq(vendorParts.vendorId, vendorId));
    expect(vp?.qtyPerBox).toBe(45);
  });

  it('retry create tidak membuat master ganda dan qty part tanpa kanban tetap per satuan', async () => {
    await db.update(vendorParts).set({ usesKanban: false, qtyPerBox: 1 }).where(eq(vendorParts.vendorId, vendorId));
    await service.save(input(45), userId);
    expect(staging.inserts).toBe(1);
    const [vp] = await db.select().from(vendorParts).where(eq(vendorParts.vendorId, vendorId));
    expect(vp).toMatchObject({ usesKanban: false, qtyPerBox: 1 });
  });

  it('API tambah supplier/part/vendor part ditutup dan penulisan kanban punya izin Admin tersendiri', async () => {
    const master = new MasterService(db);
    for (const entity of ['vendors', 'parts', 'vendorParts'] as const) {
      await expect(master.create(entity, {}, { userId, role: 'admin' })).rejects.toBeInstanceOf(ForbiddenException);
    }
    expect(Reflect.getMetadata(PERMISSION_KEY, SapController.prototype.saveKanban)).toBe('sap.kanban.write');
    expect(Reflect.getMetadata(PERMISSION_KEY, SapController.prototype.listKanban)).toBe('sap.kanban.write');
  });

  it('qty lama yang negatif dapat diperbaiki menjadi qty positif', async () => {
    staging.rows[0]!.qty = -1;
    expect(await service.save(input(10, -1, 601), userId)).toMatchObject({ qty: 10 });
    expect(staging.rows[0]!.qty).toBe(10);
  });
});
