import { Injectable, Logger } from '@nestjs/common';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  lt,
  plants,
  sql,
  stockMutations,
  stockSnapshots,
  type Database,
} from '@ares/db';
import { addDays, pendingSnapshotDates } from '@ares/domain';
import { InjectDb } from '../db/db.module';

/**
 * Membekukan saldo stok per plant+part sekali sehari (F-41).
 *
 * TT_STOCK_MUTATION append-only dan hanya bertambah; menjumlahkannya utuh tiap
 * kali layar Stok WH dibuka makan 0,5–1,2 detik pada 2 juta baris. Job ini
 * memindahkan penjumlahan itu ke luar request (aturan repo 2) dan membuatnya
 * inkremental: snapshot hari ini = snapshot kemarin + mutasi satu hari,
 * bukan mengulang seluruh riwayat.
 *
 * Snapshot adalah TURUNAN, bukan sumber kebenaran — aturan repo 7 tetap utuh.
 * Menghapus seluruh isi TT_STOCK_SNAPSHOT aman: job ini akan menyusunnya lagi
 * dari mutasi, dan layar tetap benar sementara itu (hanya lebih lambat).
 */
/** Hari snapshot yang disimpan; hanya yang terbaru dipakai membaca. */
const RETENSI_HARI = 14;

@Injectable()
export class StockSnapshotService {
  private readonly logger = new Logger(StockSnapshotService.name);

  constructor(@InjectDb() private readonly db: Database) {}

  /** Membekukan semua tanggal yang tertinggal, untuk setiap plant aktif. */
  async run(now = new Date()): Promise<{ plants: number; dates: number; rows: number }> {
    const today = jakartaDate(now);
    const activePlants = await this.db
      .select({ id: plants.id })
      .from(plants)
      .where(eq(plants.isActive, true))
      .orderBy(asc(plants.id));

    let dates = 0;
    let rows = 0;
    for (const plant of activePlants) {
      const hasil = await this.runPlant(plant.id, today);
      dates += hasil.dates;
      rows += hasil.rows;
    }
    if (dates > 0) {
      this.logger.log(`snapshot stok: ${rows} baris untuk ${dates} tanggal di ${activePlants.length} plant`);
      await this.prune(today);
    }
    return { plants: activePlants.length, dates, rows };
  }

  /**
   * Buang snapshot lama. Yang dipakai membaca hanya tanggal terbaru; sisanya
   * disimpan sebagai jaring pengaman kalau job absen beberapa hari, bukan
   * sebagai riwayat. Riwayat sesungguhnya tetap di TT_STOCK_MUTATION.
   */
  private async prune(today: string): Promise<void> {
    await this.db.delete(stockSnapshots).where(lt(stockSnapshots.asOf, addDays(today, -RETENSI_HARI)));
  }

  private async runPlant(plantId: number, today: string): Promise<{ dates: number; rows: number }> {
    const [terakhir] = await this.db
      .select({ asOf: stockSnapshots.asOf })
      .from(stockSnapshots)
      .where(eq(stockSnapshots.plantId, plantId))
      .orderBy(desc(stockSnapshots.asOf))
      .limit(1);
    const [pertama] = await this.db
      .select({ at: sql<string | null>`min(${stockMutations.occurredAt})` })
      .from(stockMutations)
      .where(eq(stockMutations.plantId, plantId));

    const dates = pendingSnapshotDates({
      lastAsOf: terakhir?.asOf ?? null,
      earliest: pertama?.at ? jakartaDate(new Date(pertama.at)) : null,
      today,
    });

    let rows = 0;
    let dari = terakhir?.asOf ?? null;
    for (const asOf of dates) {
      rows += await this.freeze(plantId, dari, asOf);
      dari = asOf;
    }
    return { dates: dates.length, rows };
  }

  /**
   * Menulis satu tanggal.
   *
   * Basisnya snapshot tanggal `dari` (kalau ada) ditambah mutasi pada rentang
   * [dari, asOf). Part yang hari itu tidak bergerak tetap disalin, supaya
   * pembacaan cukup melihat SATU tanggal — tanpa itu layar harus mencari
   * snapshot terakhir per part, yang justru mengembalikan biaya yang mau
   * dihindari.
   */
  private async freeze(plantId: number, dari: string | null, asOf: string): Promise<number> {
    const batasAtas = jakartaMidnight(asOf);
    const batasBawah = dari ? jakartaMidnight(dari) : null;

    const [sebelumnya, perubahan] = await Promise.all([
      dari
        ? this.db
            .select({
              partId: stockSnapshots.partId,
              balancePcs: stockSnapshots.balancePcs,
              mutationCount: stockSnapshots.mutationCount,
              lastAt: stockSnapshots.lastAt,
            })
            .from(stockSnapshots)
            .where(and(eq(stockSnapshots.plantId, plantId), eq(stockSnapshots.asOf, dari)))
        : Promise.resolve([]),
      this.db
        .select({
          partId: stockMutations.partId,
          deltaPcs: sql<number>`sum(${stockMutations.deltaPcs})`,
          mutationCount: count(),
          lastAt: sql<string>`max(${stockMutations.occurredAt})`,
        })
        .from(stockMutations)
        .where(
          and(
            eq(stockMutations.plantId, plantId),
            batasBawah ? gte(stockMutations.occurredAt, batasBawah) : undefined,
            lt(stockMutations.occurredAt, batasAtas),
          ),
        )
        .groupBy(stockMutations.partId),
    ]);

    const gabungan = new Map<
      number,
      { balancePcs: number; mutationCount: number; lastAt: Date | null }
    >();
    for (const row of sebelumnya) {
      gabungan.set(row.partId, {
        balancePcs: Number(row.balancePcs),
        mutationCount: Number(row.mutationCount),
        lastAt: row.lastAt,
      });
    }
    for (const row of perubahan) {
      const lama = gabungan.get(row.partId);
      const lastAt = row.lastAt ? new Date(row.lastAt) : null;
      gabungan.set(row.partId, {
        balancePcs: (lama?.balancePcs ?? 0) + Number(row.deltaPcs),
        mutationCount: (lama?.mutationCount ?? 0) + Number(row.mutationCount),
        lastAt: lastAt ?? lama?.lastAt ?? null,
      });
    }
    if (gabungan.size === 0) return 0;

    const values = [...gabungan].map(([partId, v]) => ({
      plantId,
      partId,
      asOf,
      balancePcs: v.balancePcs,
      mutationCount: v.mutationCount,
      lastAt: v.lastAt,
    }));
    // Idempoten (aturan repo 5): tanggal yang sama dihapus lalu ditulis ulang,
    // jadi job boleh dijalankan berapa kali pun — termasuk setelah mutasi lama
    // dikoreksi — tanpa menggandakan atau menyisakan part yang sudah tidak ada.
    await this.db.transaction(async (tx) => {
      await tx
        .delete(stockSnapshots)
        .where(and(eq(stockSnapshots.plantId, plantId), eq(stockSnapshots.asOf, asOf)));
      for (const chunk of potong(values, 500)) await tx.insert(stockSnapshots).values(chunk);
    });
    return values.length;
  }
}

function potong<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/** Tanggal kalender pada jam pabrik; DB menyimpan UTC (aturan repo 6). */
function jakartaDate(at: Date): string {
  return at.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
}

function jakartaMidnight(date: string): Date {
  return new Date(`${date}T00:00:00+07:00`);
}
