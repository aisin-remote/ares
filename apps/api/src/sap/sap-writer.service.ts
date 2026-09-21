import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, inArray, lt, sapOutbox, type Database } from '@ares/db';
import { InjectDb } from '../db/db.module';
import { SAP_GATEWAY, type SapGateway } from './sap.gateway';

const MAX_ATTEMPTS = 8;

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

  async flush(ids?: number[]): Promise<{ terkirim: number; gagal: number; dilewati: number }> {
    const antre = await this.db
      .select({ id: sapOutbox.id })
      .from(sapOutbox)
      .where(and(eq(sapOutbox.status, 'PENDING'), lt(sapOutbox.attempts, MAX_ATTEMPTS),
        ids ? inArray(sapOutbox.id, ids) : undefined))
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
      const hasil = await this.db.transaction(async (tx) => {
        /* Kunci yang sama dipakai pembatalan receipt. Periksa ulang sesudah lock. */
        const [row] = await tx.select().from(sapOutbox)
          .where(eq(sapOutbox.id, candidate.id)).for('update');
        if (!row || row.status !== 'PENDING' || row.attempts >= MAX_ATTEMPTS) return 'SKIP';

        try {
          const sapDocNumber = await this.gateway.send(row);
          await tx.update(sapOutbox).set({
            status: 'SENT', sentAt: new Date(), sapDocNumber, lastError: null,
            attempts: row.attempts + 1,
          }).where(eq(sapOutbox.id, row.id));
          return 'SENT';
        } catch (err) {
          const pesan = err instanceof Error ? err.message : String(err);
          await tx.update(sapOutbox).set({
            status: 'FAILED', attempts: row.attempts + 1, lastError: pesan.slice(0, 1000),
          }).where(eq(sapOutbox.id, row.id));
          this.logger.warn(`dokumen outbox ${row.id} gagal dikirim: ${pesan}`);
          return 'FAILED';
        }
      });
      if (hasil === 'SENT') terkirim += 1;
      else if (hasil === 'FAILED') gagal += 1;
      else dilewati += 1;
    }

    if (terkirim > 0 || gagal > 0)
      this.logger.log(`gateway ${this.mode}: ${terkirim} berhasil, ${gagal} gagal`);
    return { terkirim, gagal, dilewati };
  }
}
