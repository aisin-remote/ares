import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  and,
  consumptions,
  eq,
  orderQueues,
  queueAdjustments,
  sql,
  stockMutations,
  type Database,
} from '@ares/db';
import type { QueueAdjustmentInput, QueueHoldInput } from '@ares/contracts';
import { applyQueueAdjustment, planConsumptionReversal, QueueControlError } from '@ares/domain';
import { writeAudit } from '../common/audit';
import { InjectDb } from '../db/db.module';

export interface QueueActor { userId: number; plantId: number }

@Injectable()
export class QueueControlService {
  constructor(@InjectDb() private readonly db: Database) {}

  async adjust(id: number, input: QueueAdjustmentInput, actor: QueueActor) {
    return this.db.transaction(async (tx) => {
      const [queue] = await tx.select().from(orderQueues)
        .where(eq(orderQueues.id, id)).for('update');
      if (!queue) throw new NotFoundException('Antrean tidak ditemukan');
      if (queue.status !== 'OPEN') throw new ConflictException('Antrean sudah dicutoff');
      let pcs: number;
      try {
        pcs = applyQueueAdjustment(queue.pcs, input.deltaPcs);
      } catch (error) {
        if (error instanceof QueueControlError) throw new UnprocessableEntityException(error.message);
        throw error;
      }
      await tx.update(orderQueues).set({ pcs }).where(eq(orderQueues.id, id));
      const adjustmentId = (await tx.insert(queueAdjustments).values({
        queueId: id,
        deltaPcs: input.deltaPcs,
        reason: input.reason,
        userId: actor.userId,
      }).$returningId())[0]!.id;
      await writeAudit(tx, 'TT_ORDER_QUEUE', id, 'ADJUST', actor.userId,
        { pcs: queue.pcs, hold: queue.hold, status: queue.status },
        { pcs, hold: queue.hold, status: queue.status, deltaPcs: input.deltaPcs, reason: input.reason, adjustmentId });
      return { id, pcs, deltaPcs: input.deltaPcs, adjustmentId };
    });
  }

  async setHold(id: number, input: QueueHoldInput, actor: QueueActor) {
    return this.db.transaction(async (tx) => {
      const [queue] = await tx.select().from(orderQueues)
        .where(eq(orderQueues.id, id)).for('update');
      if (!queue) throw new NotFoundException('Antrean tidak ditemukan');
      if (queue.status !== 'OPEN') throw new ConflictException('Antrean sudah dicutoff');
      if (queue.hold === input.hold) throw new ConflictException(input.hold ? 'Antrean sudah ditahan' : 'Antrean sudah dilepas');
      await tx.update(orderQueues).set({ hold: input.hold }).where(eq(orderQueues.id, id));
      const adjustmentId = (await tx.insert(queueAdjustments).values({
        queueId: id,
        deltaPcs: 0,
        reason: `${input.hold ? 'HOLD' : 'RELEASE'}: ${input.reason}`,
        userId: actor.userId,
      }).$returningId())[0]!.id;
      const action = input.hold ? 'HOLD' : 'RELEASE';
      await writeAudit(tx, 'TT_ORDER_QUEUE', id, action, actor.userId,
        { pcs: queue.pcs, hold: queue.hold, status: queue.status },
        { pcs: queue.pcs, hold: input.hold, status: queue.status, reason: input.reason, adjustmentId });
      return { id, hold: input.hold, adjustmentId };
    });
  }

  /** F-15: balik seluruh komponen dari satu record produksi, tetap append-only. */
  async reverseConsumption(id: number, reason: string, actor: QueueActor) {
    return this.db.transaction(async (tx) => {
      const [seed] = await tx.select().from(consumptions)
        .where(eq(consumptions.id, id)).for('update');
      if (!seed || seed.qty <= 0) throw new NotFoundException('Konsumsi asal tidak ditemukan');

      const existingReversal = await tx.select({ id: consumptions.id }).from(consumptions).where(and(
        eq(consumptions.sourceRecordKey, seed.sourceRecordKey),
        sql`${consumptions.qty} < 0`,
      )).limit(1);
      if (existingReversal[0]) throw new ConflictException('Record konsumsi sudah dibatalkan');

      const rows = await tx.select({
        id: consumptions.id,
        sourceKey: consumptions.sourceKey,
        parentPartId: consumptions.parentPartId,
        componentPartId: consumptions.componentPartId,
        qty: consumptions.qty,
        line: consumptions.line,
        queueId: consumptions.queueId,
        queuePcs: orderQueues.pcs,
        queueStatus: orderQueues.status,
      }).from(consumptions)
        .innerJoin(orderQueues, eq(consumptions.queueId, orderQueues.id))
        .where(and(eq(consumptions.sourceRecordKey, seed.sourceRecordKey), sql`${consumptions.qty} > 0`))
        .for('update');

      let plan: ReturnType<typeof planConsumptionReversal>;
      try {
        plan = planConsumptionReversal(rows.map((row) => ({
          consumptionId: row.id,
          qty: row.qty,
          queueStatus: row.queueStatus,
        })));
      } catch (error) {
        if (error instanceof QueueControlError) throw new ConflictException(error.message);
        throw error;
      }
      const planById = new Map(plan.map((item) => [item.consumptionId, item]));
      const now = new Date();
      const reversalIds: number[] = [];
      for (const row of rows) {
        const item = planById.get(row.id)!;
        let queuePcs: number;
        try {
          queuePcs = applyQueueAdjustment(row.queuePcs, item.queueDeltaPcs);
        } catch (error) {
          if (error instanceof QueueControlError) {
            throw new ConflictException(`${error.message} untuk antrean ${row.queueId}`);
          }
          throw error;
        }
        await tx.update(orderQueues).set({ pcs: queuePcs }).where(eq(orderQueues.id, row.queueId));
        const reversalId = (await tx.insert(consumptions).values({
          sourceKey: `${row.sourceKey}:REV`,
          sourceRecordKey: seed.sourceRecordKey,
          parentPartId: row.parentPartId,
          componentPartId: row.componentPartId,
          qty: item.queueDeltaPcs,
          line: row.line,
          occurredAt: now,
          queueId: row.queueId,
        }).$returningId())[0]!.id;
        reversalIds.push(reversalId);
        await tx.insert(stockMutations).values({
          plantId: actor.plantId,
          partId: row.componentPartId,
          sloc: process.env.SAP_SLOC ?? 'WH00',
          deltaPcs: item.stockDeltaPcs,
          type: 'CONSUMPTION',
          refTable: 'TT_CONSUMPTION',
          refId: reversalId,
          note: `Pembatalan ${seed.sourceRecordKey}: ${reason}`.slice(0, 255),
          userId: actor.userId,
          occurredAt: now,
        });
        await tx.insert(queueAdjustments).values({
          queueId: row.queueId,
          deltaPcs: item.queueDeltaPcs,
          reason: `Pembatalan ${seed.sourceRecordKey}: ${reason}`.slice(0, 255),
          userId: actor.userId,
        });
      }
      await writeAudit(tx, 'TT_CONSUMPTION', seed.id, 'REVERSE', actor.userId,
        { sourceRecordKey: seed.sourceRecordKey, consumptions: rows.map((row) => ({ id: row.id, qty: row.qty, queueId: row.queueId })) },
        { reason, reversalIds });
      return { sourceRecordKey: seed.sourceRecordKey, reversed: rows.length, reversalIds };
    });
  }
}
