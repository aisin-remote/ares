import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import { JOBS, QUEUES } from '../queue/queue.constants';
import { QueueService } from '../queue/queue.service';
import { RedisService } from '../queue/redis.service';
import { CutoffService } from './cutoff.service';
import type { Actor } from './picklist.service';

type CutoffJob = {
  actor?: Actor;
  target?: { vendorId: number; cutoffAt: string; reason?: string };
};

@Injectable()
export class CutoffWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CutoffWorker.name);
  private worker?: Worker;

  constructor(
    private readonly redis: RedisService,
    private readonly queue: QueueService,
    private readonly cutoff: CutoffService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.worker = new Worker(
      QUEUES.ORDER,
      async (job: Job<CutoffJob>) => {
        if (job.name === JOBS.RUN_CUTOFF) {
          if (!job.data.actor || !job.data.target) {
            return { skipped: true, reason: 'Cutoff menunggu tindakan Admin/PPIC' };
          }
          const target = {
            vendorId: job.data.target.vendorId,
            cutoffAt: new Date(job.data.target.cutoffAt),
            reason: job.data.target.reason,
          };
          return this.cutoff.runDue(new Date(), job.data.actor, target);
        }
        return undefined;
      },
      { connection: this.redis.client, concurrency: 1 },
    );
    this.worker.on('failed', (job, error) =>
      this.logger.error(`job ${job?.name} gagal: ${error.message}`),
    );

    // Bersihkan scheduler versi lama: cutoff kini hanya dijalankan dari tombol PPIC.
    await this.queue.get(QUEUES.ORDER).removeJobScheduler(`repeat:${JOBS.RUN_CUTOFF}`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}
