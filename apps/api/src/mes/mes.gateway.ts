import { asc, gt, mesFakeRecords, type Database } from '@ares/db';
import { z } from 'zod';
import { productionResultSchema, type ProductionResultInput } from '@ares/contracts';

export const MES_GATEWAY = Symbol('MES_GATEWAY');

export interface ProductionResultPage {
  items: ProductionResultInput[];
  nextCursor: string | null;
}

export interface MesGateway {
  readonly mode: 'fake' | 'http';
  fetchProductionResults(cursor: string | null, limit: number): Promise<ProductionResultPage>;
}

/** Membaca baris yang diisi PPIC dari TT_MES_FAKE. */
export class FakeMesGateway implements MesGateway {
  readonly mode = 'fake' as const;

  constructor(private readonly db: Database) {}

  async fetchProductionResults(cursor: string | null, limit: number): Promise<ProductionResultPage> {
    const afterId = Number(cursor ?? 0);
    const rows = await this.db.select().from(mesFakeRecords)
      .where(gt(mesFakeRecords.id, Number.isSafeInteger(afterId) ? afterId : 0))
      .orderBy(asc(mesFakeRecords.id)).limit(limit);
    return {
      items: rows.map((row) => ({
        id: row.recordId,
        partNo: row.partNo,
        qty: row.qty,
        line: row.line,
        producedAt: row.producedAt.toISOString(),
      })),
      nextCursor: rows.length > 0 ? String(rows.at(-1)!.id) : cursor,
    };
  }
}

const pageSchema = z.object({
  items: z.array(productionResultSchema),
  nextCursor: z.string().nullable(),
});

/** Gateway HTTP sesuai kontrak PRD §8.2. */
export class HttpMesGateway implements MesGateway {
  readonly mode = 'http' as const;

  async fetchProductionResults(cursor: string | null, limit: number): Promise<ProductionResultPage> {
    const base = process.env.MES_API_URL?.replace(/\/$/, '');
    if (!base) throw new Error('MES_API_URL wajib diisi untuk MES_GATEWAY=http');
    const url = new URL(`${base}/production-results`);
    if (cursor) url.searchParams.set('since', cursor);
    url.searchParams.set('limit', String(limit));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(url, {
        headers: process.env.MES_API_TOKEN
          ? { Authorization: `Bearer ${process.env.MES_API_TOKEN}` }
          : undefined,
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`MES menjawab HTTP ${response.status}`);
      return pageSchema.parse(await response.json());
    } finally {
      clearTimeout(timeout);
    }
  }
}
