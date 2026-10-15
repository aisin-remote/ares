import { Injectable } from '@nestjs/common';
import { and, eq, sql, sequences, type Transaction } from '@ares/db';
import { dateKey, formatDocNo, formatOrderSheetNo, orderPlantInitial } from '@ares/domain';

/**
 * Penomoran dokumen (F-21, 6.6.2): unik, berurutan per hari, aman dari dua
 * proses bersamaan.
 *
 * Baris TM_SEQUENCE dikunci dengan `SELECT … FOR UPDATE` di dalam transaksi
 * pemanggil, jadi dua request yang menerbitkan picklist pada detik yang sama
 * antre di baris itu — bukan `MAX()+1` yang bisa memberi nomor kembar.
 * Nomor yang sudah diambil ikut rollback bila transaksinya gagal, tapi
 * nomor yang commit tidak pernah dipakai ulang.
 */
@Injectable()
export class SequenceService {
  private async allocate(tx: Transaction, code: string, key: string): Promise<number> {
    const where = and(eq(sequences.code, code), eq(sequences.dateKey, key));

    let [row] = await tx
      .select({ lastNo: sequences.lastNo })
      .from(sequences)
      .where(where)
      .for('update');
    if (!row) {
      await tx
        .insert(sequences)
        .values({ code, dateKey: key, lastNo: 0 })
        .onDuplicateKeyUpdate({ set: { lastNo: sql`${sequences.lastNo}` } });
      [row] = await tx
        .select({ lastNo: sequences.lastNo })
        .from(sequences)
        .where(where)
        .for('update');
    }

    const nextNo = (row?.lastNo ?? 0) + 1;
    await tx.update(sequences).set({ lastNo: nextNo }).where(where);
    return nextNo;
  }

  /** Nomor berikutnya, mis. `PL-260918-0042`. Harus dipanggil di dalam transaksi. */
  async next(tx: Transaction, code: 'PL' | 'RCP', now = new Date()): Promise<string> {
    const key = dateKey(now);
    const nextNo = await this.allocate(tx, code, key);
    return formatDocNo(code, now, nextNo);
  }

  /** Nomor Order Sheet berurutan per plant dan tanggal delivery. */
  async nextOrder(tx: Transaction, plantCode: string, deliveryDate: string): Promise<string> {
    const key = deliveryDate.slice(2).replaceAll('-', '');
    const sequence = await this.allocate(tx, `OS${orderPlantInitial(plantCode)}`, key);
    return formatOrderSheetNo(plantCode, deliveryDate, sequence);
  }
}
