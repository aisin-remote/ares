import { ConflictException, Injectable } from '@nestjs/common';
import {
  count,
  eq,
  mesCursors,
  mesFailures,
  mesFakeRecords,
  type Database,
} from '@ares/db';
import type { FakeProductionResultInput } from '@ares/contracts';
import { InjectDb } from '../db/db.module';
import { QueueService } from '../queue/queue.service';
import { JOBS, QUEUES } from '../queue/queue.constants';
import { MES_GATEWAY, type MesGateway } from './mes.gateway';
import { Inject } from '@nestjs/common';
import { ConsumptionService } from './consumption.service';

const SOURCE = 'production-results';

@Injectable()
export class MesSyncService {
  constructor(
    @InjectDb() private readonly db: Database,
    @Inject(MES_GATEWAY) private readonly gateway: MesGateway,
    private readonly consumption: ConsumptionService,
    private readonly queue: QueueService,
  ) {}

  async enqueue(): Promise<{ queued: true; jobId?: string }> {
    const jobId = await this.queue.add(QUEUES.MES, JOBS.MES_SYNC, {});
    return { queued: true, jobId };
  }

  async sync(limit = 100) {
    const [cursorRow] = await this.db.select().from(mesCursors)
      .where(eq(mesCursors.source, SOURCE)).limit(1);
    const page = await this.gateway.fetchProductionResults(cursorRow?.cursor ?? null, limit);
    let created = 0;
    let duplicates = 0;
    const failures: Array<{ id: string; error: string }> = [];

    for (const item of page.items) {
      const outcome = await this.consumption.ingest(item);
      if (outcome.status === 'CREATED') created++;
      else if (outcome.status === 'DUPLICATE') duplicates++;
      else failures.push({ id: item.id, error: outcome.error });

      if (this.gateway.mode === 'fake') {
        await this.db.update(mesFakeRecords).set({
          status: outcome.status === 'FAILED' ? 'FAILED' : 'PROCESSED',
          error: outcome.status === 'FAILED' ? outcome.error.slice(0, 1000) : null,
          processedAt: outcome.status === 'FAILED' ? null : new Date(),
        }).where(eq(mesFakeRecords.recordId, item.id));
      }
    }

    // Cursor maju hanya bila satu halaman tuntas. Record yang sudah berhasil
    // aman diputar ulang karena SOURCE_KEY unik.
    if (failures.length === 0) {
      await this.db.insert(mesCursors).values({
        source: SOURCE,
        cursor: page.nextCursor,
        syncedAt: new Date(),
      }).onDuplicateKeyUpdate({ set: { cursor: page.nextCursor, syncedAt: new Date(), updatedAt: new Date() } });
    }
    return { fetched: page.items.length, created, duplicates, failures, cursorAdvanced: failures.length === 0 };
  }

  async addFake(input: FakeProductionResultInput) {
    if (this.gateway.mode !== 'fake') throw new ConflictException('Input uji hanya tersedia saat MES_GATEWAY=fake');
    const inserted = await this.db.insert(mesFakeRecords).values({
      recordId: input.id,
      partNo: input.partNo,
      qty: input.qty,
      line: input.line,
      producedAt: new Date(input.producedAt),
    }).$returningId();
    return { id: inserted[0]!.id, recordId: input.id };
  }

  async status() {
    const [[cursor], [failureCount], fakeRows] = await Promise.all([
      this.db.select().from(mesCursors).where(eq(mesCursors.source, SOURCE)).limit(1),
      this.db.select({ value: count() }).from(mesFailures),
      this.gateway.mode === 'fake'
        ? this.db.select({ status: mesFakeRecords.status, value: count() }).from(mesFakeRecords).groupBy(mesFakeRecords.status)
        : Promise.resolve([]),
    ]);
    return {
      gateway: this.gateway.mode,
      enabled: ['true', '1', 'yes', 'y', 'on'].includes((process.env.MES_SYNC_ENABLED ?? '').toLowerCase()),
      intervalSec: Number(process.env.MES_SYNC_INTERVAL_SEC ?? 120),
      cursor: cursor?.cursor ?? null,
      syncedAt: cursor?.syncedAt ?? null,
      failures: failureCount?.value ?? 0,
      fake: Object.fromEntries(fakeRows.map((row) => [row.status, row.value])),
    };
  }
}
