import { Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, lte, orderQueues, users, vendorParts, type Database } from '@ares/db';
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

/** F-16: orkestrasi cutoff due; keputusan per antrean tetap di PicklistService. */
@Injectable()
export class CutoffService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly picklists: PicklistService,
    private readonly queue: QueueService,
  ) {}

  async enqueue(actor: Actor): Promise<{ queued: true; jobId?: string }> {
    const jobId = await this.queue.add(QUEUES.ORDER, JOBS.RUN_CUTOFF, { actor });
    return { queued: true, jobId };
  }

  async runDue(now = new Date(), requestedBy?: Actor): Promise<CutoffRunSummary> {
    const actor = requestedBy ?? (await this.systemActor());
    const due = await this.db
      .select({ vendorId: vendorParts.vendorId, cutoffAt: orderQueues.cutoffAt })
      .from(orderQueues)
      .innerJoin(vendorParts, eq(orderQueues.vendorPartId, vendorParts.id))
      .where(and(eq(orderQueues.status, 'OPEN'), lte(orderQueues.cutoffAt, now)))
      .orderBy(asc(orderQueues.cutoffAt), asc(vendorParts.vendorId));

    const groups = new Map<string, { vendorId: number; cutoffAt: Date }>();
    for (const row of due) {
      groups.set(`${row.vendorId}:${row.cutoffAt.toISOString()}`, row);
    }

    const results: CutoffRunSummary['results'] = [];
    for (const group of groups.values()) {
      const result = await this.picklists.issueAutomatic(group.vendorId, group.cutoffAt, actor);
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

  private async systemActor(): Promise<Actor> {
    const npk = process.env.CUTOFF_SYSTEM_USER_NPK ?? 'ADMIN';
    const [user] = await this.db
      .select({ userId: users.id, plantId: users.plantId })
      .from(users)
      .where(eq(users.npk, npk))
      .limit(1);
    if (!user?.plantId) {
      throw new NotFoundException(`User sistem cutoff ${npk} tidak ditemukan atau belum terikat pabrik`);
    }
    return { userId: user.userId, plantId: user.plantId };
  }
}
