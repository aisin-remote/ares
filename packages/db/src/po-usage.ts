import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import type { Database, Transaction } from './client';
import { picklistHeaders, picklistLines } from './schema/index';

/**
 * Pcs yang sudah dipesan ARES per PO item (F-19): semua Order Sheet yang
 * tidak batal, termasuk yang sudah diterima. Line yang kurang kirim dihitung
 * sebesar BOX_SHIPPED; sisanya ada di Order Sheet recovery, jadi tidak dobel.
 * Dipakai API (validasi) dan web (tampilan sisa) supaya angkanya sama.
 */
export async function poItemUsage(db: Database | Transaction, poNos: readonly string[]) {
  if (poNos.length === 0) return new Map<string, number>();
  const rows = await db
    .select({
      sapPoNo: picklistLines.sapPoNo,
      sapPoItem: picklistLines.sapPoItem,
      pcs: sql<number>`coalesce(sum(coalesce(${picklistLines.boxShipped} * ${picklistLines.qtyPerBox}, ${picklistLines.pcs})), 0)`,
    })
    .from(picklistLines)
    .innerJoin(picklistHeaders, eq(picklistLines.picklistId, picklistHeaders.id))
    .where(and(ne(picklistHeaders.status, 'CANCELLED'), inArray(picklistLines.sapPoNo, [...poNos])))
    .groupBy(picklistLines.sapPoNo, picklistLines.sapPoItem);
  return new Map(rows.map((r) => [`${r.sapPoNo}:${r.sapPoItem}`, Number(r.pcs)]));
}
