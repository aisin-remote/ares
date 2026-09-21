import { Injectable, NotFoundException } from '@nestjs/common';
import { auditLogs, eq, parts, stockMutations, type Database } from '@ares/db';
import type { StockAdjustInput } from '@ares/contracts';
import { InjectDb } from '../db/db.module';

export interface StockActor {
  userId: number;
  plantId: number;
}

/**
 * Stok WH (F-41, F-42). Saldo tidak pernah ditulis: stok = SUM(DELTA_PCS)
 * dari TT_STOCK_MUTATION (aturan repo 7). Penyesuaian = baris ADJUST baru
 * beralasan + jejak audit dalam transaksi yang sama.
 */
@Injectable()
export class StockService {
  constructor(@InjectDb() private readonly db: Database) {}

  async adjust(input: StockAdjustInput, actor: StockActor) {
    const [part] = await this.db
      .select({ id: parts.id, partNo: parts.partNo })
      .from(parts)
      .where(eq(parts.id, input.partId));
    if (!part) throw new NotFoundException('Part tidak ditemukan');

    const sloc = input.sloc?.trim() || process.env.SAP_SLOC || 'WH00';
    const now = new Date();
    return this.db.transaction(async (tx) => {
      const id = (
        await tx
          .insert(stockMutations)
          .values({
            plantId: actor.plantId,
            partId: part.id,
            sloc,
            deltaPcs: input.deltaPcs,
            type: 'ADJUST',
            note: input.reason,
            userId: actor.userId,
            occurredAt: now,
          })
          .$returningId()
      )[0]!.id;
      await tx.insert(auditLogs).values({
        entity: 'stock',
        entityId: String(part.id),
        action: 'ADJUST',
        userId: actor.userId,
        before: null,
        after: {
          mutationId: id,
          partNo: part.partNo,
          sloc,
          deltaPcs: input.deltaPcs,
          reason: input.reason,
        },
      });
      return { id, partId: part.id, sloc, deltaPcs: input.deltaPcs, occurredAt: now };
    });
  }
}
