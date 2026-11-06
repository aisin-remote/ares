import 'server-only';
import { and, auditLogs, count, desc, emailDeliveries, eq, getReadDb, inArray,
  or, picklistHeaders, receiptHeaders, scanEvents, sql, users } from '@ares/db';
import { describeOrderActivity } from '@ares/domain';

export interface OrderActivity {
  id: string;
  at: Date;
  actor: string;
  title: string;
  detail: string | null;
  eta?: Date;
}

/** F-54: akses dibatasi order+pabrik+supplier sebelum membaca audit atau penerima email. */
export async function getOrderHistory(reference: string, plantId: number, vendorId: number | null) {
  const db = getReadDb();
  const [order] = await db.select({ id: picklistHeaders.id, createdAt: picklistHeaders.createdAt,
    createdBy: users.name, downloadedAt: picklistHeaders.downloadedAt, shippedAt: picklistHeaders.shippedAt,
  }).from(picklistHeaders).leftJoin(users, eq(picklistHeaders.createdById, users.id)).where(and(
    eq(picklistHeaders.publicId, reference), eq(picklistHeaders.plantId, plantId),
    vendorId !== null ? eq(picklistHeaders.vendorId, vendorId) : undefined,
  )).limit(1);
  if (!order) return [];
  const receipts = await db.select({ id: receiptHeaders.id, receiptNo: receiptHeaders.receiptNo,
    createdAt: receiptHeaders.createdAt, closedAt: receiptHeaders.closedAt, status: receiptHeaders.status,
    actor: users.name,
  }).from(receiptHeaders).leftJoin(users, eq(receiptHeaders.userId, users.id))
    .where(and(eq(receiptHeaders.picklistId, order.id), eq(receiptHeaders.plantId, plantId)));
  const [logs, scans] = await Promise.all([
    db.select({ id: auditLogs.id, entity: auditLogs.entity, entityId: auditLogs.entityId, action: auditLogs.action,
      before: auditLogs.before, after: auditLogs.after, at: auditLogs.at, actor: users.name,
    }).from(auditLogs).leftJoin(users, eq(auditLogs.userId, users.id)).where(or(
      and(eq(auditLogs.entity, 'TT_PICKLIST_H'), eq(auditLogs.entityId, String(order.id))),
      receipts.length ? and(eq(auditLogs.entity, 'TT_RECEIPT_H'),
        inArray(auditLogs.entityId, receipts.map((receipt) => String(receipt.id)))) : undefined,
    )).orderBy(desc(auditLogs.at), desc(auditLogs.id)).limit(200),
    db.select({ sessionId: scanEvents.sessionId, actorId: scanEvents.userId, actor: users.name,
      boxes: count(), at: sql<string>`date_format(max(${scanEvents.occurredAt}), '%Y-%m-%dT%H:%i:%sZ')`, receiptNo: receiptHeaders.receiptNo,
    }).from(scanEvents).innerJoin(receiptHeaders, eq(scanEvents.sessionId, receiptHeaders.id))
      .leftJoin(users, eq(scanEvents.userId, users.id)).where(and(
        eq(receiptHeaders.picklistId, order.id), eq(receiptHeaders.plantId, plantId), eq(scanEvents.result, 'OK'),
      )).groupBy(scanEvents.sessionId, scanEvents.userId, users.name, receiptHeaders.receiptNo),
  ]);
  const events: OrderActivity[] = logs.flatMap((log) => {
    const summary = describeOrderActivity(log.entity, log.action, log.before, log.after);
    const value = log.after && typeof log.after === 'object' ? (log.after as Record<string, unknown>).eta : null;
    const eta = typeof value === 'string' ? new Date(value) : undefined;
    return summary ? [{ id: `audit-${log.id}`, at: log.at, actor: log.actor ?? 'Pengguna', ...summary,
      eta: eta && !Number.isNaN(eta.getTime()) ? eta : undefined,
    }] : [];
  });
  // Data lama hanya memakai timestamp yang benar-benar tersimpan; pelaku tidak ditebak.
  if (!logs.some((log) => ['ISSUE', 'ISSUE_AUTO', 'CREATE_REVISION'].includes(log.action)))
    events.push({ id: 'created', at: order.createdAt, actor: order.createdBy ?? 'Data order lama',
      title: 'Order Sheet dibuat', detail: 'Berdasarkan waktu pembuatan order' });
  if (order.downloadedAt && !logs.some((log) => log.action === 'DOWNLOAD'))
    events.push({ id: 'downloaded', at: order.downloadedAt, actor: 'Supplier (akun tidak tercatat)',
      title: 'Dokumen diunduh supplier', detail: 'Berdasarkan waktu unduhan pertama' });
  if (order.shippedAt && !logs.some((log) => log.action === 'CONFIRM_SHIPMENT'))
    events.push({ id: 'shipped', at: order.shippedAt, actor: 'Data order lama',
      title: 'Pengiriman dikonfirmasi', detail: 'Berdasarkan waktu konfirmasi pengiriman' });
  for (const receipt of receipts) {
    const hasAudit = (action: string) => logs.some((log) => log.entity === 'TT_RECEIPT_H'
      && log.entityId === String(receipt.id) && log.action === action);
    if (!hasAudit('OPEN')) events.push({ id: `receipt-open-${receipt.id}`, at: receipt.createdAt,
      actor: 'Data penerimaan lama (pembuka tidak tercatat)', title: 'Sesi receiving dibuka', detail: receipt.receiptNo });
    if (receipt.closedAt && !hasAudit('CLOSE')) events.push({ id: `receipt-close-${receipt.id}`, at: receipt.closedAt,
      actor: receipt.status === 'CLOSED' ? receipt.actor ?? 'Data penerimaan lama' : 'Data penerimaan lama',
      title: 'Sesi receiving ditutup', detail: `${receipt.receiptNo} · berdasarkan waktu penutupan sesi` });
  }
  for (const scan of scans) events.push({ id: `scan-${scan.sessionId}-${scan.actorId}`, at: new Date(scan.at),
    actor: scan.actor ?? 'Operator', title: `${scan.boxes} box dipindai`,
    detail: `${scan.receiptNo} · waktu scan terakhir operator` });
  return events.sort((a, b) => b.at.getTime() - a.at.getTime());
}

/** Khusus layar internal; selalu join order agar ID email tidak membuka data lintas pabrik. */
export async function getOrderEmails(reference: string, plantId: number) {
  return getReadDb().select({
    id: emailDeliveries.id, kind: emailDeliveries.kind, status: emailDeliveries.status,
    recipients: emailDeliveries.recipients, cc: emailDeliveries.cc, accepted: emailDeliveries.accepted,
    attempts: emailDeliveries.attempts, lastError: emailDeliveries.lastError,
    createdAt: emailDeliveries.createdAt, attemptedAt: emailDeliveries.attemptedAt,
    finishedAt: emailDeliveries.finishedAt, requestedBy: users.name,
  }).from(emailDeliveries).innerJoin(picklistHeaders, eq(emailDeliveries.picklistId, picklistHeaders.id))
    .leftJoin(users, eq(emailDeliveries.requestedById, users.id)).where(and(
      eq(picklistHeaders.publicId, reference), eq(picklistHeaders.plantId, plantId),
    )).orderBy(desc(emailDeliveries.id)).limit(50);
}
