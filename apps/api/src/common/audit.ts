import { auditLogs, type Transaction } from '@ares/db';

/** F-54: panggil hanya dari transaksi dokumen yang sedang diubah. */
export async function writeAudit(
  tx: Transaction,
  entity: string,
  entityId: string | number,
  action: string,
  userId: number,
  before: unknown,
  after: unknown,
): Promise<void> {
  await tx.insert(auditLogs).values({
    entity,
    entityId: String(entityId),
    action,
    userId,
    before,
    after,
  });
}
