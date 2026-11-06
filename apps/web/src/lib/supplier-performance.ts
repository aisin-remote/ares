import 'server-only';
import { and, asc, eq, getReadDb, gte, inArray, lte, ne, picklistHeaders, picklistLines,
  receiptHeaders, receiptLines, scanEvents, kanbanEvents, sql, vendorParts, vendors } from '@ares/db';
import { calculateSupplierPerformance, type SupplierPerformanceOrder } from '@ares/domain';

export interface PerformanceFilter {
  from: string; to: string; asOf: Date; toleranceMinutes: number; vendorId?: number;
}

/** F-50: cakupan pabrik wajib dari sesi; filter URL tidak dapat menggantikannya. */
export async function getSupplierPerformance(plantId: number, filter: PerformanceFilter) {
  const db = getReadDb();
  const roots = await db.select({ id: picklistHeaders.id, publicId: picklistHeaders.publicId,
    orderNo: picklistHeaders.picklistNo, vendorId: vendors.id, vendorName: vendors.name,
    vendorCode: vendors.sapVendorNo, status: picklistHeaders.status,
    deliveryDate: picklistHeaders.deliveryDate, arrivalTime: picklistHeaders.arrivalTime,
    createdAt: picklistHeaders.createdAt, confirmedAt: picklistHeaders.shippedAt,
  }).from(picklistHeaders).innerJoin(vendors, eq(picklistHeaders.vendorId, vendors.id)).where(and(
    eq(picklistHeaders.plantId, plantId), eq(picklistHeaders.revision, 0), ne(picklistHeaders.status, 'CANCELLED'),
    gte(picklistHeaders.deliveryDate, filter.from), lte(picklistHeaders.deliveryDate, filter.to),
    lte(picklistHeaders.createdAt, filter.asOf),
    filter.vendorId !== undefined ? eq(picklistHeaders.vendorId, filter.vendorId) : undefined,
  )).orderBy(asc(picklistHeaders.deliveryDate), asc(vendors.name), asc(picklistHeaders.id)).limit(5001);
  if (roots.length > 5000) throw new Error('Lebih dari 5.000 order dalam pilihan ini. Persempit periode atau pilih satu supplier.');
  if (!roots.length) return calculateSupplierPerformance([], filter.asOf, filter.toleranceMinutes);

  const families = await db.select({ id: picklistHeaders.id, orderNo: picklistHeaders.picklistNo, vendorId: picklistHeaders.vendorId })
    .from(picklistHeaders).where(and(eq(picklistHeaders.plantId, plantId),
      inArray(picklistHeaders.picklistNo, roots.map((root) => root.orderNo)), ne(picklistHeaders.status, 'CANCELLED')));
  const familyIds = families.map((family) => family.id);
  const rootByKey = new Map(roots.map((root) => [`${root.vendorId}:${root.orderNo}`, root.id]));
  const rootIdByFamily = new Map(families.map((family) => [family.id, rootByKey.get(`${family.vendorId}:${family.orderNo}`)!]));
  const utcMin = (column: typeof scanEvents.occurredAt) => sql<string>`date_format(min(${column}), '%Y-%m-%dT%H:%i:%sZ')`;

  const [ordered, received, arrivals, sessions, automatic] = await Promise.all([
    db.select({ rootId: picklistLines.picklistId, partId: vendorParts.partId,
      pcs: sql<number>`sum(${picklistLines.pcs})`, boxes: sql<number>`sum(${picklistLines.boxOrdered})`,
    }).from(picklistLines).innerJoin(vendorParts, eq(picklistLines.vendorPartId, vendorParts.id))
      .where(inArray(picklistLines.picklistId, roots.map((root) => root.id)))
      .groupBy(picklistLines.picklistId, vendorParts.partId),
    db.select({ familyId: receiptHeaders.picklistId, partId: vendorParts.partId,
      pcs: sql<number>`sum(${receiptLines.pcsReceived})`, boxes: sql<number>`sum(${receiptLines.boxReceived})`,
    }).from(receiptLines).innerJoin(receiptHeaders, eq(receiptLines.receiptId, receiptHeaders.id))
      .innerJoin(picklistLines, eq(receiptLines.picklistLineId, picklistLines.id))
      .innerJoin(vendorParts, eq(picklistLines.vendorPartId, vendorParts.id))
      .where(and(eq(receiptHeaders.plantId, plantId), inArray(receiptHeaders.picklistId, familyIds),
        eq(receiptHeaders.status, 'CLOSED'), lte(receiptHeaders.closedAt, filter.asOf)))
      .groupBy(receiptHeaders.picklistId, vendorParts.partId),
    db.select({ familyId: receiptHeaders.picklistId, at: utcMin(scanEvents.occurredAt) })
      .from(scanEvents).innerJoin(receiptHeaders, eq(scanEvents.sessionId, receiptHeaders.id))
      .where(and(eq(receiptHeaders.plantId, plantId), inArray(receiptHeaders.picklistId, familyIds),
        ne(receiptHeaders.status, 'CANCELLED'), eq(scanEvents.result, 'OK'), lte(scanEvents.occurredAt, filter.asOf)))
      .groupBy(receiptHeaders.picklistId),
    db.select({ familyId: receiptHeaders.picklistId }).from(receiptHeaders)
      .where(and(eq(receiptHeaders.plantId, plantId), inArray(receiptHeaders.picklistId, familyIds),
        ne(receiptHeaders.status, 'CANCELLED'), lte(receiptHeaders.createdAt, filter.asOf))),
    db.select({ familyId: receiptHeaders.picklistId }).from(kanbanEvents)
      .innerJoin(receiptHeaders, eq(kanbanEvents.ref, receiptHeaders.receiptNo))
      .where(and(eq(receiptHeaders.plantId, plantId), inArray(receiptHeaders.picklistId, familyIds),
        ne(receiptHeaders.status, 'CANCELLED'), eq(kanbanEvents.type, 'SHIPPED_AUTO'), lte(kanbanEvents.occurredAt, filter.asOf)))
      .groupBy(receiptHeaders.picklistId),
  ]);
  const observations = new Map<number, SupplierPerformanceOrder>(roots.map((root) => [root.id, {
    ...root, vendorCode: root.vendorCode ?? '—',
    scheduledAt: new Date(`${root.deliveryDate}T${root.arrivalTime.slice(0, 8)}+07:00`),
    firstScanAt: null, hasReceiving: false, autoShipped: false, lines: [],
  }]));
  for (const line of ordered) observations.get(line.rootId)!.lines.push({ partId: line.partId,
    orderedPcs: Number(line.pcs), orderedBoxes: Number(line.boxes), receivedPcs: 0, receivedBoxes: 0 });
  for (const row of received) {
    const root = observations.get(rootIdByFamily.get(row.familyId)!);
    if (!root) continue;
    let line = root.lines.find((item) => item.partId === row.partId);
    if (!line) { line = { partId: row.partId, orderedPcs: 0, orderedBoxes: 0, receivedPcs: 0, receivedBoxes: 0 }; root.lines.push(line); }
    line.receivedPcs += Number(row.pcs); line.receivedBoxes += Number(row.boxes);
  }
  for (const row of arrivals) {
    const root = observations.get(rootIdByFamily.get(row.familyId)!);
    const at = new Date(row.at);
    if (root && (!root.firstScanAt || at < root.firstScanAt)) root.firstScanAt = at;
  }
  for (const row of sessions) { const root = observations.get(rootIdByFamily.get(row.familyId)!); if (root) root.hasReceiving = true; }
  for (const row of automatic) { const root = observations.get(rootIdByFamily.get(row.familyId)!); if (root) root.autoShipped = true; }
  return calculateSupplierPerformance([...observations.values()], filter.asOf, filter.toleranceMinutes);
}

export async function getPerformanceSuppliers(plantId: number) {
  return getReadDb().selectDistinct({ id: vendors.id, name: vendors.name, code: vendors.sapVendorNo })
    .from(vendors).innerJoin(picklistHeaders, eq(picklistHeaders.vendorId, vendors.id))
    .where(eq(picklistHeaders.plantId, plantId)).orderBy(asc(vendors.name));
}
