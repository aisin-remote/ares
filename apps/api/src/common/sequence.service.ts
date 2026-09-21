import { Injectable } from '@nestjs/common';
import { and, eq, sql, sequences, type Transaction } from '@ares/db';
import { dateKey, formatDocNo } from '@ares/domain';

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
  /** Nomor berikutnya, mis. `PL-260918-0042`. Harus dipanggil di dalam transaksi. */
  async next(tx: Transaction, code: 'PL' | 'RCP', now = new Date()): Promise<string> {
    const key = dateKey(now);
    const where = and(eq(sequences.code, code), eq(sequences.dateKey, key));

    let [row] = await tx
      .select({ lastNo: sequences.lastNo })
      .from(sequences)
      .where(where)
      .for('update');
    if (!row) {
      // Baris hari ini belum ada. Dua transaksi bisa sampai sini bersamaan;
      // unique index menolak yang kedua, lalu ia mengunci baris yang menang.
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
    return formatDocNo(code, now, nextNo);
  }
}
