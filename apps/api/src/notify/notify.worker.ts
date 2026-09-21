import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import { RedisService } from '../queue/redis.service';
import { QUEUES, JOBS } from '../queue/queue.constants';
import { NotifyService, type NotificationJob } from './notify.service';

/** Worker `send-notification` (F-31): SMTP lambat/mati tidak boleh menahan request. */
@Injectable()
export class NotifyWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotifyWorker.name);
  private worker?: Worker;

  constructor(
    private readonly redis: RedisService,
    private readonly notify: NotifyService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker(
      QUEUES.NOTIFICATION,
      async (job: Job<NotificationJob>) => {
        if (job.name !== JOBS.SEND_NOTIFICATION) return undefined;
        return this.notify.sendPicklistNotice(job.data);
      },
      { connection: this.redis.client, concurrency: 2 },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.error(`notifikasi gagal (job ${job?.id}): ${err.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
  }
}
