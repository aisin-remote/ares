import { and, eq, gte, orderQueues, vendorParts, vendors, type Transaction } from '@ares/db';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * F-14: hari cutoff supplier yang antreannya sudah ditutup sejak `from`, untuk
 * `assignCutoff`. Baris supplier dikunci FOR UPDATE — penerbitan Order Sheet
 * juga mengunci baris itu — supaya konsumsi yang masuk saat Order Sheet terbit
 * menunggu, lalu pindah ke hari cutoff berikutnya, bukan menambah pcs ke
 * antrean yang baru saja ditutup.
 */
export async function closedCutoffs(tx: Transaction, vendorId: number, from: Date): Promise<Set<number>> {
  await tx.select({ id: vendors.id }).from(vendors).where(eq(vendors.id, vendorId)).for('update');
  const rows = await tx
    .select({ cutoffAt: orderQueues.cutoffAt, status: orderQueues.status })
    .from(orderQueues)
    .innerJoin(vendorParts, eq(orderQueues.vendorPartId, vendorParts.id))
    .where(and(
      eq(vendorParts.vendorId, vendorId),
      // Sehari ke belakang cukup menjangkau 00:00 WIB hari `from`.
      gte(orderQueues.cutoffAt, new Date(from.getTime() - DAY_MS)),
    ));
  return new Set(rows.filter((row) => row.status === 'CLOSED').map((row) => row.cutoffAt.getTime()));
}
