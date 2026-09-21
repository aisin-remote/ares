import { Injectable } from '@nestjs/common';
import {
  and,
  asc,
  bomLines,
  consumptions,
  eq,
  holidays,
  mesFailures,
  orderQueues,
  parts,
  plants,
  sql,
  stockMutations,
  vendorCutoffs,
  vendorParts,
  type Database,
} from '@ares/db';
import type { ProductionResultInput } from '@ares/contracts';
import { assignCutoff, consumeProduction } from '@ares/domain';
import { InjectDb } from '../db/db.module';

export type ConsumptionOutcome =
  | { status: 'CREATED'; consumptionIds: number[] }
  | { status: 'DUPLICATE'; consumptionIds: number[] }
  | { status: 'FAILED'; error: string };

/** Satu record MES diproses secara atomik: konsumsi, stok, dan antrean. */
@Injectable()
export class ConsumptionService {
  constructor(@InjectDb() private readonly db: Database) {}

  async ingest(
    input: ProductionResultInput,
    actor?: { userId?: number; plantId?: number },
  ): Promise<ConsumptionOutcome> {
    const sourceKey = `MES:${input.id}`;
    const existing = await this.db
      .select({ id: consumptions.id })
      .from(consumptions)
      .where(eq(consumptions.sourceKey, sourceKey));
    if (existing.length > 0) return { status: 'DUPLICATE', consumptionIds: existing.map((r) => r.id) };

    try {
      const [parent] = await this.db
        .select({ id: parts.id })
        .from(parts)
        .where(eq(parts.partNo, input.partNo))
        .limit(1);
      if (!parent) throw new Error(`Part jadi ${input.partNo} tidak ditemukan`);

      const [bom, vps, cutoffRows, holidayRows] = await Promise.all([
        this.db.select().from(bomLines),
        this.db.select().from(vendorParts).where(eq(vendorParts.isActive, true)),
        this.db.select().from(vendorCutoffs).where(eq(vendorCutoffs.isActive, true)),
        this.db.select({ date: holidays.date }).from(holidays).where(eq(holidays.isActive, true)),
      ]);
      const occurredAt = new Date(input.producedAt);
      const components = consumeProduction(
        { id: input.id, parentPartId: parent.id, qty: input.qty, line: input.line, occurredAt },
        bom.map((line) => ({
          parentPartId: line.parentPartId,
          componentPartId: line.componentPartId,
          qtyPer: Number(line.qtyPer),
          effectiveFrom: line.effectiveFrom,
          effectiveTo: line.effectiveTo,
        })),
        vps.map((vp) => ({ id: vp.id, partId: vp.partId, isActive: vp.isActive })),
      );
      if (components.length === 0) throw new Error(`BOM aktif untuk ${input.partNo} tidak ditemukan`);

      const vpById = new Map(vps.map((vp) => [vp.id, vp]));
      const assigned = components.map((component) => {
        const vp = vpById.get(component.vendorPartId)!;
        const cutoff = assignCutoff(
          occurredAt,
          cutoffRows
            .filter((row) => row.vendorId === vp.vendorId)
            .map((row) => ({
              id: row.id,
              cutoffTime: row.cutoffTime,
              workdays: row.workdays,
              leadDays: row.leadDays,
              arrivalTime: row.arrivalTime,
              holidayShift: row.holidayShift,
            })),
          holidayRows.map((row) => row.date),
        );
        if (!cutoff) throw new Error(`Jadwal cutoff aktif untuk vendor part ${vp.id} tidak ditemukan`);
        return { component, cutoff };
      });

      const plantId = actor?.plantId ?? (await this.defaultPlantId());
      const ids = await this.db.transaction(async (tx) => {
        // Cek ulang di dalam transaksi untuk dua worker yang menerima record sama.
        const marker = await tx.select({ id: consumptions.id }).from(consumptions)
          .where(eq(consumptions.sourceKey, sourceKey)).limit(1);
        if (marker[0]) return [marker[0].id];

        const consumptionIds: number[] = [];
        for (const { component, cutoff } of assigned) {
          await tx.insert(orderQueues).values({
            vendorPartId: component.vendorPartId,
            cutoffAt: cutoff.cutoffAt,
            pcs: component.qty,
          }).onDuplicateKeyUpdate({
            set: {
              pcs: sql`${orderQueues.pcs} + ${component.qty}`,
              updatedAt: new Date(),
            },
          });
          const [queue] = await tx.select({ id: orderQueues.id }).from(orderQueues).where(and(
            eq(orderQueues.vendorPartId, component.vendorPartId),
            eq(orderQueues.cutoffAt, cutoff.cutoffAt),
          )).limit(1);
          if (!queue) throw new Error('Antrean order gagal dibuat');

          const inserted = await tx.insert(consumptions).values({
            sourceKey: component.sourceKey,
            sourceRecordKey: sourceKey,
            parentPartId: component.parentPartId,
            componentPartId: component.componentPartId,
            qty: component.qty,
            line: component.line,
            occurredAt: component.occurredAt,
            queueId: queue.id,
          }).$returningId();
          const consumptionId = inserted[0]!.id;
          consumptionIds.push(consumptionId);
          await tx.insert(stockMutations).values({
            plantId,
            partId: component.componentPartId,
            sloc: process.env.SAP_SLOC ?? 'WH00',
            deltaPcs: -component.qty,
            type: 'CONSUMPTION',
            refTable: 'TT_CONSUMPTION',
            refId: consumptionId,
            note: `MES ${input.id} · line ${input.line}`,
            userId: actor?.userId,
            occurredAt,
          });
        }
        return consumptionIds;
      });
      await this.db.delete(mesFailures).where(eq(mesFailures.sourceKey, sourceKey));
      return { status: 'CREATED', consumptionIds: ids };
    } catch (error) {
      if (isDuplicateKey(error)) {
        const rows = await this.db.select({ id: consumptions.id }).from(consumptions)
          .where(eq(consumptions.sourceKey, sourceKey));
        return { status: 'DUPLICATE', consumptionIds: rows.map((r) => r.id) };
      }
      const message = error instanceof Error ? error.message : 'Konsumsi gagal diproses';
      await this.db.insert(mesFailures).values({
        sourceKey,
        recordId: input.id,
        partNo: input.partNo,
        qty: input.qty,
        line: input.line,
        occurredAt: new Date(input.producedAt),
        error: message.slice(0, 1000),
      }).onDuplicateKeyUpdate({ set: { error: message.slice(0, 1000), updatedAt: new Date() } });
      return { status: 'FAILED', error: message };
    }
  }

  private async defaultPlantId(): Promise<number> {
    const [plant] = await this.db.select({ id: plants.id }).from(plants)
      .where(eq(plants.isActive, true)).orderBy(asc(plants.id)).limit(1);
    if (!plant) throw new Error('Pabrik aktif tidak ditemukan');
    return plant.id;
  }
}

function isDuplicateKey(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { errno?: number; code?: string; cause?: { errno?: number; code?: string } };
  return value.errno === 1062 || value.code === 'ER_DUP_ENTRY' || value.cause?.errno === 1062 || value.cause?.code === 'ER_DUP_ENTRY';
}
