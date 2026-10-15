import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, inArray, lt, lte, or, isNull, sapOutbox, type Database } from '@ares/db';
import { InjectDb } from '../db/db.module';
import { SAP_GATEWAY, type SapGateway } from './sap.gateway';

const MAX_ATTEMPTS = 8;
const PROCESSING_TIMEOUT_MS = 10 * 60_000;

/** 30 detik, 1 menit, 2 menit, ... maksimal 30 menit. */
function retryDelayMs(attempt: number): number {
  return Math.min(30 * 60_000, 30_000 * 2 ** Math.max(0, attempt - 1));
}

/** Mengirim antrean outbox melalui gateway yang dipilih dengan SAP_GATEWAY. */
@Injectable()
export class SapWriterService {
  private readonly logger = new Logger(SapWriterService.name);

  constructor(
    @InjectDb() private readonly db: Database,
    @Inject(SAP_GATEWAY) private readonly gateway: SapGateway,
  ) {}

  get aktif(): boolean {
    return this.gateway.enabled;
  }

  get mode(): SapGateway['mode'] {
    return this.gateway.mode;
  }

  async flush(ids?: number[], plantId?: number): Promise<{ terkirim: number; gagal: number; dilewati: number }> {
    const now = new Date();
    await this.db.update(sapOutbox).set({
      status: 'PENDING',
      nextAttemptAt: now,
      lastError: 'Proses sebelumnya terhenti; dokumen dijadwalkan ulang secara aman',
    }).where(and(
      eq(sapOutbox.status, 'PROCESSING'),
      lt(sapOutbox.lastAttemptAt, new Date(now.getTime() - PROCESSING_TIMEOUT_MS)),
      plantId ? eq(sapOutbox.plantId, plantId) : undefined,
    ));

    const antre = await this.db
      .select({ id: sapOutbox.id })
      .from(sapOutbox)
      .where(and(eq(sapOutbox.status, 'PENDING'), lt(sapOutbox.attempts, MAX_ATTEMPTS),
        or(isNull(sapOutbox.nextAttemptAt), lte(sapOutbox.nextAttemptAt, now)),
        ids ? inArray(sapOutbox.id, ids) : undefined,
        plantId ? eq(sapOutbox.plantId, plantId) : undefined))
      .orderBy(asc(sapOutbox.occurredAt))
      .limit(100);

    if (antre.length === 0) return { terkirim: 0, gagal: 0, dilewati: 0 };
    if (!this.aktif) {
      this.logger.debug(`${antre.length} dokumen menunggu; gateway ${this.mode} belum aktif`);
      return { terkirim: 0, gagal: 0, dilewati: antre.length };
    }

    let terkirim = 0;
    let gagal = 0;
    let dilewati = 0;
    for (const candidate of antre) {
      /* Klaim cepat di MySQL, lalu tutup transaksi sebelum menyentuh jaringan. */
      const row = await this.db.transaction(async (tx) => {
        const [row] = await tx.select().from(sapOutbox)
          .where(eq(sapOutbox.id, candidate.id)).for('update');
        if (!row || row.status !== 'PENDING' || row.attempts >= MAX_ATTEMPTS) return null;
        if (row.nextAttemptAt && row.nextAttemptAt > new Date()) return null;
        const claimed = { ...row, status: 'PROCESSING' as const, attempts: row.attempts + 1 };
        await tx.update(sapOutbox).set({
          status: 'PROCESSING',
          attempts: claimed.attempts,
          lastAttemptAt: new Date(),
          nextAttemptAt: null,
        }).where(eq(sapOutbox.id, row.id));
        return claimed;
      });
      if (!row) {
        dilewati += 1;
        continue;
      }

      try {
        const result = await this.gateway.send(row);
        const finishedAt = new Date();
        await this.db.update(sapOutbox).set(result.status === 'POSTED' ? {
          status: 'POSTED',
          stagedAt: finishedAt,
          postedAt: finishedAt,
          sentAt: finishedAt,
          sapDocNumber: result.sapDocNumber,
          lastError: null,
          nextAttemptAt: null,
        } : {
          status: 'STAGED',
          stagedAt: finishedAt,
          sentAt: finishedAt,
          lastError: null,
          nextAttemptAt: null,
        }).where(and(eq(sapOutbox.id, row.id), eq(sapOutbox.status, 'PROCESSING')));
        terkirim += 1;
      } catch (err) {
        const pesan = err instanceof Error ? err.message : String(err);
        const final = row.attempts >= MAX_ATTEMPTS;
        await this.db.update(sapOutbox).set({
          status: final ? 'FAILED' : 'PENDING',
          nextAttemptAt: final ? null : new Date(Date.now() + retryDelayMs(row.attempts)),
          lastError: pesan.slice(0, 1000),
        }).where(and(eq(sapOutbox.id, row.id), eq(sapOutbox.status, 'PROCESSING')));
        gagal += 1;
        this.logger.warn(
          `dokumen outbox ${row.id} gagal pada percobaan ${row.attempts}/${MAX_ATTEMPTS}: ${pesan}`,
        );
      }
    }

    if (terkirim > 0 || gagal > 0)
      this.logger.log(`gateway ${this.mode}: ${terkirim} berhasil, ${gagal} gagal`);
    return { terkirim, gagal, dilewati };
  }
}
