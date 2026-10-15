import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import { QueueService } from '../queue/queue.service';
import { RedisService } from '../queue/redis.service';
import { JOBS, QUEUES } from '../queue/queue.constants';
import { StockSnapshotService } from './stock-snapshot.service';

/**
 * Pembeku saldo stok harian (F-41).
 *
 * Dijadwalkan lewat cron 00:20 jam pabrik — setelah tengah malam, supaya
 * mutasi kemarin sudah lengkap, tetapi sebelum shift pagi membuka layar Stok
 * WH. Jadwalnya idempoten (`upsertJobScheduler`), jadi restart tidak membuat
 * jadwal kedua, dan job-nya sendiri boleh jalan berapa kali pun.
 */
@Injectable()
export class StockWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StockWorker.name);
  private worker?: Worker;

  constructor(
    private readonly redis: RedisService,
    private readonly queue: QueueService,
    private readonly snapshot: StockSnapshotService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.worker = new Worker(
      QUEUES.STOCK,
      async (job: Job) => {
        if (job.name === JOBS.SNAPSHOT_STOCK) return this.snapshot.run();
        return undefined;
      },
      { connection: this.redis.client, concurrency: 1 },
    );
    this.worker.on('failed', (job, error) =>
      this.logger.error(`job ${job?.name} gagal: ${error.message}`),
    );

    await this.queue.addRepeating(
      QUEUES.STOCK,
      JOBS.SNAPSHOT_STOCK,
      {},
      process.env.STOCK_SNAPSHOT_CRON ?? '20 0 * * *',
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}
