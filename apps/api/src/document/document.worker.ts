import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import { RedisService } from '../queue/redis.service';
import { QUEUES, JOBS } from '../queue/queue.constants';
import { DocumentService } from './document.service';

/**
 * Worker render PDF (F-27).
 *
 * Render adalah pekerjaan CPU yang sinkron: selama satu picklist digambar,
 * event loop proses ini tertahan. Karena itu concurrency 1 — menambahnya tidak
 * mempercepat apa pun pada satu proses Node, hanya membuat antrean scan ikut
 * menunggu lebih lama.
 *
 * ponytail: di `pnpm dev` worker dan API hidup di satu proses, jadi picklist
 * dengan ratusan kanban akan membuat endpoint scanner tersendat beberapa detik.
 * Jalan naiknya sudah disiapkan queue.module (proses worker terpisah); baru
 * perlu dikerjakan kalau volumenya sudah terasa.
 */
@Injectable()
export class DocumentWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DocumentWorker.name);
  private worker?: Worker;

  constructor(
    private readonly redis: RedisService,
    private readonly documents: DocumentService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker(
      QUEUES.DOCUMENT,
      async (job: Job<{ picklistId: number }>) => {
        if (job.name !== JOBS.RENDER_PDF) return undefined;
        const { picklistId } = job.data;
        if (!picklistId) throw new Error('job render-pdf tanpa picklistId');
        return this.documents.render(picklistId);
      },
      { connection: this.redis.client, concurrency: 1 },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.error(`render PDF gagal (job ${job?.id}): ${err.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
  }
}
