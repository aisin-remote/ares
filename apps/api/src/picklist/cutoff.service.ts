import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { RunCutoffInput } from '@ares/contracts';
import { and, asc, eq, lte, orderQueues, vendors, vendorParts, type Database } from '@ares/db';
import { InjectDb } from '../db/db.module';
import { JOBS, QUEUES } from '../queue/queue.constants';
import { QueueService } from '../queue/queue.service';
import { PicklistService, type Actor, type AutoIssueResult } from './picklist.service';

export interface CutoffRunSummary {
  groups: number;
  created: number;
  blocked: number;
  skipped: number;
  results: Array<{ vendorId: number; cutoffAt: Date; result: AutoIssueResult }>;
}

export interface CutoffTarget {
  vendorId: number;
  cutoffAt: Date;
  reason?: string;
}

export type CutoffJobStatus =
  | { status: 'PROCESSING' }
  | { status: 'COMPLETED'; result: CutoffRunSummary }
  | { status: 'FAILED'; error: string };

/** F-16: orkestrasi cutoff due; keputusan per antrean tetap di PicklistService. */
@Injectable()
export class CutoffService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly picklists: PicklistService,
    private readonly queue: QueueService,
  ) {}

  async enqueue(actor: Actor, input: RunCutoffInput): Promise<{ queued: true; jobId?: string }> {
    const cutoffAt = new Date(input.cutoffAt);
    if (cutoffAt.getTime() > Date.now()) {
      throw new BadRequestException('Order belum dapat diproses karena waktu cutoff belum tercapai');
    }

    const [group] = await this.db
      .select({ plantId: vendors.plantId })
      .from(orderQueues)
      .innerJoin(vendorParts, eq(orderQueues.vendorPartId, vendorParts.id))
      .innerJoin(vendors, eq(vendorParts.vendorId, vendors.id))
      .where(
        and(
          eq(orderQueues.status, 'OPEN'),
          eq(vendorParts.vendorId, input.vendorId),
          eq(orderQueues.cutoffAt, cutoffAt),
        ),
      )
      .limit(1);
    if (!group) throw new NotFoundException('Antrean supplier pada cutoff ini sudah tidak tersedia');
    if (group.plantId !== actor.plantId) {
      throw new BadRequestException('Antrean supplier bukan milik pabrik pengguna');
    }

    const target = {
      vendorId: input.vendorId,
      cutoffAt: cutoffAt.toISOString(),
      reason: input.reason,
    };
    const jobId = await this.queue.add(QUEUES.ORDER, JOBS.RUN_CUTOFF, { actor, target });
    return { queued: true, jobId };
  }

  async jobStatus(jobId: string, actor: Actor): Promise<CutoffJobStatus> {
    if (!/^[-_:a-zA-Z0-9]{1,128}$/.test(jobId)) {
      throw new BadRequestException('ID proses cutoff tidak valid');
    }
    const job = await this.queue.get(QUEUES.ORDER).getJob(jobId);
    const data = job?.data as { actor?: Actor } | undefined;
    if (
      !job ||
      job.name !== JOBS.RUN_CUTOFF ||
      data?.actor?.userId !== actor.userId ||
      data.actor.plantId !== actor.plantId
    ) {
      throw new NotFoundException('Proses cutoff tidak ditemukan');
    }
    const state = await job.getState();
    if (state === 'completed') {
      return { status: 'COMPLETED', result: job.returnvalue as CutoffRunSummary };
    }
    if (state === 'failed') {
      return { status: 'FAILED', error: job.failedReason || 'Pembuatan Order Sheet gagal' };
    }
    return { status: 'PROCESSING' };
  }

  async runDue(
    now: Date,
    actor: Actor,
    target: CutoffTarget,
  ): Promise<CutoffRunSummary> {
    const due = await this.db
      .select({ vendorId: vendorParts.vendorId, cutoffAt: orderQueues.cutoffAt })
      .from(orderQueues)
      .innerJoin(vendorParts, eq(orderQueues.vendorPartId, vendorParts.id))
      .where(
        and(
          eq(orderQueues.status, 'OPEN'),
          lte(orderQueues.cutoffAt, now),
          eq(vendorParts.vendorId, target.vendorId),
          eq(orderQueues.cutoffAt, target.cutoffAt),
        ),
      )
      .orderBy(asc(orderQueues.cutoffAt), asc(vendorParts.vendorId));

    const groups = new Map<string, { vendorId: number; cutoffAt: Date }>();
    for (const row of due) {
      groups.set(`${row.vendorId}:${row.cutoffAt.toISOString()}`, row);
    }

    const results: CutoffRunSummary['results'] = [];
    for (const group of groups.values()) {
      const result = await this.picklists.issueAutomatic(
        group.vendorId,
        group.cutoffAt,
        actor,
        target.reason,
      );
      results.push({ ...group, result });
    }
    return {
      groups: results.length,
      created: results.filter((row) => row.result.status === 'CREATED').length,
      blocked: results.filter((row) => row.result.status === 'BLOCKED').length,
      skipped: results.filter((row) => row.result.status === 'SKIPPED').length,
      results,
    };
  }

}
