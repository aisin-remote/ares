import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import { RedisService } from '../queue/redis.service';
import { QueueService } from '../queue/queue.service';
import { QUEUES, JOBS } from '../queue/queue.constants';
import {
  NotifyService,
  type NotificationJob,
  type SupplierRegistrationNoticeJob,
  type VendorPartNoticeJob,
} from './notify.service';

/** Worker `send-notification` (F-31): SMTP lambat/mati tidak boleh menahan request. */
@Injectable()
export class NotifyWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotifyWorker.name);
  private worker?: Worker;

  constructor(
    private readonly redis: RedisService,
    private readonly queue: QueueService,
    private readonly notify: NotifyService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.worker = new Worker(
      QUEUES.NOTIFICATION,
      async (job: Job<NotificationJob | VendorPartNoticeJob | SupplierRegistrationNoticeJob>) => {
        if (job.name === JOBS.SEND_NOTIFICATION)
          return this.notify.sendPicklistNotice(job.data as NotificationJob);
        if (job.name === JOBS.NOTIFY_VENDOR_PART)
          return this.notify.sendVendorPartNotice(job.data as VendorPartNoticeJob);
        if (job.name === JOBS.NOTIFY_SUPPLIER_REGISTRATION)
          return this.notify.sendSupplierRegistrationNotice(job.data as SupplierRegistrationNoticeJob);
        if (job.name === JOBS.SEND_REMINDER) return this.notify.sendDueReminders();
        return undefined;
      },
      { connection: this.redis.client, concurrency: 2 },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.error(`notifikasi gagal (job ${job?.id}): ${err.message}`);
    });
    await this.queue.addRepeating(QUEUES.NOTIFICATION, JOBS.SEND_REMINDER, {}, '*/15 * * * *');
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
  }
}
