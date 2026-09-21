import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import { QueueService } from '../queue/queue.service';
import { RedisService } from '../queue/redis.service';
import { JOBS, QUEUES } from '../queue/queue.constants';
import { MesSyncService } from './mes-sync.service';

@Injectable()
export class MesWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MesWorker.name);
  private worker?: Worker;

  constructor(
    private readonly redis: RedisService,
    private readonly queue: QueueService,
    private readonly mes: MesSyncService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.worker = new Worker(QUEUES.MES, async (job: Job) => {
      if (job.name === JOBS.MES_SYNC) return this.mes.sync();
      return undefined;
    }, { connection: this.redis.client, concurrency: 1 });
    this.worker.on('failed', (job, error) => this.logger.error(`job ${job?.name} gagal: ${error.message}`));

    const enabled = ['true', '1', 'yes', 'y', 'on'].includes((process.env.MES_SYNC_ENABLED ?? '').toLowerCase());
    if (enabled) {
      await this.queue.addRepeatingEvery(
        QUEUES.MES,
        JOBS.MES_SYNC,
        {},
        Number(process.env.MES_SYNC_INTERVAL_SEC ?? 120) * 1000,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}
