import assert from 'node:assert/strict';
import { getSupplierPerformance } from '../apps/web/src/lib/supplier-performance';
import { getDb, closeDb, eq, inArray, plants, vendors, parts, vendorParts, picklistHeaders,
  picklistLines, receiptHeaders, receiptLines, scanEvents } from '../packages/db/dist/index';

const db = getDb();
const stamp = Date.now().toString().slice(-10);
let vendorId: number | undefined;
let partId: number | undefined;
let vendorPartId: number | undefined;
const orderIds: number[] = [];
const receiptIds: number[] = [];

async function main() {
  const plantRows = await db.select({ id: plants.id }).from(plants).limit(2);
  const plantId = plantRows[0]!.id;
  const otherPlant = plantRows[1]!.id;
  vendorId = (await db.insert(vendors).values({ sapVendorNo: `PF${stamp}`, name: 'Supplier fixture performa', plantId }).$returningId())[0]!.id;
  partId = (await db.insert(parts).values({ partNo: `PF${stamp}`, sapMaterialNo: `PF${stamp}`, name: 'Part fixture' }).$returningId())[0]!.id;
  vendorPartId = (await db.insert(vendorParts).values({ vendorId, partId, qtyPerBox: 50, backNo: 'PF' }).$returningId())[0]!.id;
  const createOrder = async (revision: number, plant = plantId, no = `PF${stamp}`) => {
    const id = (await db.insert(picklistHeaders).values({ vendorId: vendorId!, plantId: plant,
      picklistNo: no, revision, type: 'MANUAL', status: 'SHIPPED', cutoffAt: new Date('2026-10-19T00:00:00Z'),
      deliveryDate: revision ? '2026-10-21' : '2026-10-20', arrivalTime: '10:00:00',
      createdAt: new Date('2026-10-19T00:00:00Z'), shippedAt: new Date('2026-10-19T02:00:00Z'),
    }).$returningId())[0]!.id;
    orderIds.push(id);
    const lineId = (await db.insert(picklistLines).values({ picklistId: id, vendorPartId: vendorPartId!,
      boxOrdered: revision ? 1 : 2, pcs: revision ? 50 : 100, qtyPerBox: 50, sapPoNo: 'TEST', sapPoItem: '1',
    }).$returningId())[0]!.id;
    return { id, lineId };
  };
  const root = await createOrder(0);
  const recovery = await createOrder(1);
  await createOrder(0, otherPlant, `PF-OTHER-${stamp}`);
  const createReceipt = async (order: typeof root, day: string, status: 'CLOSED' | 'CANCELLED', pcs = 50) => {
    const id = (await db.insert(receiptHeaders).values({ plantId, picklistId: order.id, receiptNo: `PF${stamp}-${receiptIds.length}`,
      status, createdAt: new Date(`${day}T03:00:00Z`), closedAt: new Date(`${day}T03:30:00Z`),
    }).$returningId())[0]!.id;
    receiptIds.push(id);
    await db.insert(receiptLines).values({ receiptId: id, picklistLineId: order.lineId, boxReceived: 1, pcsReceived: pcs });
    await db.insert(scanEvents).values({ sessionId: id, dedupeKey: `PF-${stamp}-${id}`, code: 'TEST', result: 'OK',
      occurredAt: new Date(`${day}T03:10:00Z`) });
  };
  await createReceipt(root, '2026-10-20', 'CLOSED');
  await createReceipt(recovery, '2026-10-21', 'CLOSED');
  await createReceipt(root, '2026-10-19', 'CANCELLED', 999);
  const filter = { from: '2026-10-20', to: '2026-10-22', asOf: new Date('2026-10-22T01:00:00Z'), toleranceMinutes: 0, vendorId };
  const report = await getSupplierPerformance(plantId, filter);
  assert.equal(report.total.orders, 1, 'Recovery tidak boleh menjadi order kedua');
  assert.equal(report.total.orderedPcs, 100, 'Kebutuhan hanya dari order asal');
  assert.equal(report.total.receivedPcs, 100, 'Penerimaan recovery digabung; pembatalan dikecualikan');
  assert.equal(report.total.fulfillmentPercent, 100);
  assert.equal(report.total.late, 1);
  assert.equal(report.orders[0]!.firstScanAt!.toISOString(), '2026-10-20T03:10:00.000Z');
  assert.equal(report.total.averageConfirmationMinutes, 120);
  const earlier = await getSupplierPerformance(plantId, { ...filter, to: '2026-10-20', asOf: new Date('2026-10-20T16:59:59Z') });
  assert.equal(earlier.total.receivedPcs, 50, 'Penerimaan sesudah batas penilaian tidak ikut');
  assert.equal((await getSupplierPerformance(plantId, { ...filter, toleranceMinutes: 15 })).total.onTime, 1);
  const foreign = await getSupplierPerformance(otherPlant, { ...filter, from: '2026-10-21' });
  assert.equal(foreign.total.orders, 0, 'Order pabrik lain tidak bocor');
  console.log('Lulus: recovery, pembatalan receipt, periode historis, toleransi, konfirmasi, dan scope pabrik.');
}

async function cleanup() {
  if (receiptIds.length) { await db.delete(scanEvents).where(inArray(scanEvents.sessionId, receiptIds)); await db.delete(receiptHeaders).where(inArray(receiptHeaders.id, receiptIds)); }
  if (orderIds.length) await db.delete(picklistHeaders).where(inArray(picklistHeaders.id, orderIds));
  if (vendorPartId) await db.delete(vendorParts).where(eq(vendorParts.id, vendorPartId));
  if (partId) await db.delete(parts).where(eq(parts.id, partId));
  if (vendorId) await db.delete(vendors).where(eq(vendors.id, vendorId));
  await closeDb();
}
main().finally(cleanup).catch((error) => { console.error(error); process.exitCode = 1; });
