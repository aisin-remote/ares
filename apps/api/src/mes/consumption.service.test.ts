import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConflictException } from '@nestjs/common';
import {
  and,
  bomLines,
  closeDb,
  consumptions,
  eq,
  getDb,
  inArray,
  mesFailures,
  orderQueues,
  queueAdjustments,
  auditLogs,
  parts,
  plants,
  stockMutations,
  sum,
  users,
  vendorCutoffs,
  vendorParts,
  vendors,
} from '@ares/db';
import { ConsumptionService } from './consumption.service';
import { QueueControlService } from './queue-control.service';

const db = getDb();
const service = new ConsumptionService(db);
const controls = new QueueControlService(db);
const stamp = Date.now().toString().slice(-10);
const sourceId = `IT-${stamp}`;
let actor: { userId: number; plantId: number };
let vendorId: number;
let parentId: number;
let componentIds: number[] = [];
let vendorPartIds: number[] = [];

beforeAll(async () => {
  const [plant] = await db.select({ id: plants.id }).from(plants).limit(1);
  const [user] = await db.select({ id: users.id }).from(users).limit(1);
  if (!plant || !user) throw new Error('Jalankan `pnpm db:seed` dulu');
  actor = { userId: user.id, plantId: plant.id };

  vendorId = (await db.insert(vendors).values({
    sapVendorNo: `MV${stamp}`,
    name: 'Supplier uji MES',
  }).$returningId())[0]!.id;
  const partRows = await db.insert(parts).values([
    { sapMaterialNo: `MP${stamp}`, partNo: `PARENT-${stamp}`, name: 'Part jadi uji' },
    { sapMaterialNo: `MC1${stamp}`, partNo: `COMP-1-${stamp}`, name: 'Komponen uji 1' },
    { sapMaterialNo: `MC2${stamp}`, partNo: `COMP-2-${stamp}`, name: 'Komponen uji 2' },
  ]).$returningId();
  parentId = partRows[0]!.id;
  componentIds = partRows.slice(1).map((row) => row.id);
  await db.insert(bomLines).values(componentIds.map((componentPartId, index) => ({
    parentPartId: parentId,
    componentPartId,
    qtyPer: String(index + 1),
    effectiveFrom: '2026-01-01',
  })));
  vendorPartIds = await db.insert(vendorParts).values(componentIds.map((partId, index) => ({
    partId,
    vendorId,
    qtyPerBox: 10,
    backNo: `M-${index + 1}`,
  }))).$returningId().then((rows) => rows.map((row) => row.id));
  await db.insert(vendorCutoffs).values({
    vendorId,
    cutoffTime: '10:00:00',
    workdays: '1,2,3,4,5',
    leadDays: 1,
    arrivalTime: '08:00:00',
  });
});

afterAll(async () => {
  const queueRows = await db.select({ id: orderQueues.id }).from(orderQueues)
    .where(inArray(orderQueues.vendorPartId, vendorPartIds));
  const consumptionRows = await db.select({ id: consumptions.id }).from(consumptions)
    .where(eq(consumptions.parentPartId, parentId));
  await db.delete(stockMutations).where(inArray(stockMutations.partId, componentIds));
  if (queueRows.length > 0) {
    await db.delete(queueAdjustments).where(inArray(queueAdjustments.queueId, queueRows.map((row) => row.id)));
    await db.delete(auditLogs).where(and(
      eq(auditLogs.entity, 'TT_ORDER_QUEUE'),
      inArray(auditLogs.entityId, queueRows.map((row) => String(row.id))),
    ));
  }
  if (consumptionRows.length > 0) {
    await db.delete(auditLogs).where(and(
      eq(auditLogs.entity, 'TT_CONSUMPTION'),
      inArray(auditLogs.entityId, consumptionRows.map((row) => String(row.id))),
    ));
  }
  await db.delete(consumptions).where(eq(consumptions.parentPartId, parentId));
  await db.delete(orderQueues).where(inArray(orderQueues.vendorPartId, vendorPartIds));
  await db.delete(mesFailures).where(eq(mesFailures.sourceKey, `MES:${sourceId}`));
  await db.delete(bomLines).where(eq(bomLines.parentPartId, parentId));
  await db.delete(vendorParts).where(eq(vendorParts.vendorId, vendorId));
  await db.delete(vendorCutoffs).where(eq(vendorCutoffs.vendorId, vendorId));
  await db.delete(parts).where(inArray(parts.id, [parentId, ...componentIds]));
  await db.delete(vendors).where(eq(vendors.id, vendorId));
  await closeDb();
});

describe('ConsumptionService.ingest (F-10–F-12)', () => {
  it('mengurai dua komponen secara atomik dan replay tidak mengubah apa pun', async () => {
    const input = {
      id: sourceId,
      partNo: `PARENT-${stamp}`,
      qty: 5,
      line: 'LINE-1',
      producedAt: '2026-09-21T01:00:00.000Z',
    };
    const first = await service.ingest(input, actor);
    expect(first.status).toBe('CREATED');

    const consumptionRows = await db.select().from(consumptions)
      .where(eq(consumptions.parentPartId, parentId));
    expect(consumptionRows).toHaveLength(2);
    expect(consumptionRows.map((row) => row.qty).sort((a, b) => a - b)).toEqual([5, 10]);

    const mutationRows = await db.select().from(stockMutations)
      .where(and(inArray(stockMutations.partId, componentIds), eq(stockMutations.refTable, 'TT_CONSUMPTION')));
    expect(mutationRows).toHaveLength(2);
    expect(mutationRows.map((row) => row.deltaPcs).sort((a, b) => a - b)).toEqual([-10, -5]);

    const queueRows = await db.select().from(orderQueues)
      .where(inArray(orderQueues.vendorPartId, vendorPartIds));
    expect(queueRows).toHaveLength(2);
    expect(queueRows.map((row) => row.pcs).sort((a, b) => a - b)).toEqual([5, 10]);

    const replay = await service.ingest(input, actor);
    expect(replay.status).toBe('DUPLICATE');
    expect(await db.select().from(consumptions).where(eq(consumptions.parentPartId, parentId))).toHaveLength(2);
    expect(await db.select().from(stockMutations).where(and(
      inArray(stockMutations.partId, componentIds),
      eq(stockMutations.refTable, 'TT_CONSUMPTION'),
    ))).toHaveLength(2);
    const totals = await db.select({ pcs: sum(orderQueues.pcs) }).from(orderQueues)
      .where(inArray(orderQueues.vendorPartId, vendorPartIds));
    expect(Number(totals[0]?.pcs)).toBe(15);
  });

  it('koreksi/hold tercatat dan pembatalan membalik satu record lengkap', async () => {
    const queues = await db.select().from(orderQueues)
      .where(inArray(orderQueues.vendorPartId, vendorPartIds));
    const target = queues.sort((a, b) => a.pcs - b.pcs)[0]!;

    await controls.adjust(target.id, { kanban: 1, reason: 'Koreksi hasil produksi' }, actor);
    await controls.setHold(target.id, { hold: true, reason: 'Tunggu konfirmasi line' }, actor);
    await controls.setHold(target.id, { hold: false, reason: 'Line sudah terkonfirmasi' }, actor);
    const [adjusted] = await db.select().from(orderQueues).where(eq(orderQueues.id, target.id));
    expect(adjusted).toMatchObject({ pcs: 10, hold: false });

    const [origin] = await db.select().from(consumptions)
      .where(and(eq(consumptions.parentPartId, parentId), eq(consumptions.sourceKey, `MES:${sourceId}`)));
    const reversed = await controls.reverseConsumption(origin!.id, 'Record produksi dibatalkan MES', actor);
    expect(reversed.reversed).toBe(2);

    const allConsumptions = await db.select().from(consumptions)
      .where(eq(consumptions.sourceRecordKey, `MES:${sourceId}`));
    expect(allConsumptions).toHaveLength(4);
    expect(allConsumptions.filter((row) => row.qty < 0).map((row) => row.qty).sort((a, b) => a - b)).toEqual([-10, -5]);

    const afterQueues = await db.select().from(orderQueues)
      .where(inArray(orderQueues.vendorPartId, vendorPartIds));
    expect(afterQueues.map((row) => row.pcs).sort((a, b) => a - b)).toEqual([0, 5]);
    const mutations = await db.select().from(stockMutations)
      .where(and(inArray(stockMutations.partId, componentIds), eq(stockMutations.refTable, 'TT_CONSUMPTION')));
    expect(mutations).toHaveLength(4);
    expect(mutations.reduce((sum, row) => sum + row.deltaPcs, 0)).toBe(0);
    expect(await db.select().from(queueAdjustments)
      .where(inArray(queueAdjustments.queueId, afterQueues.map((row) => row.id)))).toHaveLength(5);
    const queueAudit = await db.select({ action: auditLogs.action }).from(auditLogs)
      .where(and(eq(auditLogs.entity, 'TT_ORDER_QUEUE'), eq(auditLogs.entityId, String(target.id))));
    expect(queueAudit.map((row) => row.action)).toEqual(['ADJUST', 'HOLD', 'RELEASE']);
    const reversalAudit = await db.select({ action: auditLogs.action }).from(auditLogs)
      .where(and(eq(auditLogs.entity, 'TT_CONSUMPTION'), eq(auditLogs.entityId, String(origin!.id))));
    expect(reversalAudit.map((row) => row.action)).toEqual(['REVERSE']);

    await expect(controls.reverseConsumption(origin!.id, 'Ulang', actor))
      .rejects.toBeInstanceOf(ConflictException);

    const closedSource = `${sourceId}-CLOSED`;
    expect((await service.ingest({
      id: closedSource,
      partNo: `PARENT-${stamp}`,
      qty: 2,
      line: 'LINE-1',
      producedAt: '2026-09-22T01:00:00.000Z',
    }, actor)).status).toBe('CREATED');
    const [closedOrigin] = await db.select().from(consumptions)
      .where(eq(consumptions.sourceKey, `MES:${closedSource}`));
    await db.update(orderQueues).set({ status: 'CLOSED' })
      .where(eq(orderQueues.id, closedOrigin!.queueId));
    await expect(controls.reverseConsumption(closedOrigin!.id, 'Terlambat dikoreksi', actor))
      .rejects.toBeInstanceOf(ConflictException);
    const closedRows = await db.select().from(consumptions)
      .where(eq(consumptions.sourceRecordKey, `MES:${closedSource}`));
    expect(closedRows).toHaveLength(2);
    expect(closedRows.every((row) => row.qty > 0)).toBe(true);
  });
});
