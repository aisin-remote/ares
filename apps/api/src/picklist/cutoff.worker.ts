import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import { JOBS, QUEUES } from '../queue/queue.constants';
import { QueueService } from '../queue/queue.service';
import { RedisService } from '../queue/redis.service';
import { CutoffService } from './cutoff.service';
import type { Actor } from './picklist.service';

type CutoffJob = { actor?: Actor };

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
        if (job.name === JOBS.RUN_CUTOFF) return this.cutoff.runDue(new Date(), job.data.actor);
        return undefined;
      },
      { connection: this.redis.client, concurrency: 1 },
    );
    this.worker.on('failed', (job, error) =>
      this.logger.error(`job ${job?.name} gagal: ${error.message}`),
    );

    const enabled = ['true', '1', 'yes', 'y', 'on'].includes(
      (process.env.CUTOFF_ENABLED ?? 'true').toLowerCase(),
    );
    if (enabled) {
      await this.queue.addRepeatingEvery(
        QUEUES.ORDER,
        JOBS.RUN_CUTOFF,
        {},
        Number(process.env.CUTOFF_INTERVAL_SEC ?? 60) * 1000,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}
