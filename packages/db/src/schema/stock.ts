import {
  mysqlTable,
  varchar,
  int,
  bigint,
  date,
  timestamp,
  mysqlEnum,
  index,
  uniqueIndex,
} from 'drizzle-orm/mysql-core';
import { relations } from 'drizzle-orm';
import { STOCK_MUTATION_TYPES } from '@ares/contracts';
import { pk, fk, timestamps } from './_shared';
import { plants, users } from './org';
import { parts } from './master';

/**
 * Buku stok WH, append-only (F-41, 6.5.4).
 *
 * Stok per part = SUM(DELTA_PCS). Tidak ada kolom saldo yang diedit; koreksi
 * (F-42) adalah baris baru bertipe ADJUST dengan alasan. Naik saat receipt
 * dibuat, bukan saat GR terkonfirmasi SAP.
 */
export const stockMutations = mysqlTable(
  'TT_STOCK_MUTATION',
  {
    id: pk(),
    plantId: fk('PLANT_ID')
      .notNull()
      .references(() => plants.id),
    partId: fk('PART_ID')
      .notNull()
      .references(() => parts.id),
    /** Storage location SAP; nilai default diputuskan di fase 0 (PRD §13). */
    sloc: varchar('SLOC', { length: 16 }).notNull(),
    deltaPcs: int('DELTA_PCS').notNull(),
    type: mysqlEnum('TYPE', STOCK_MUTATION_TYPES).notNull(),
    /** Dokumen asal: TT_RECEIPT_L / TT_CONSUMPTION; ADJUST tanpa rujukan. */
    refTable: varchar('REF_TABLE', { length: 64 }),
    refId: fk('REF_ID'),
    note: varchar('NOTE', { length: 255 }),
    userId: fk('USER_ID').references(() => users.id),
    occurredAt: timestamp('OCCURRED_AT').notNull(),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    index('TT_STOCK_MUTATION_PART_IDX').on(t.partId, t.sloc, t.occurredAt),
    index('TT_STOCK_MUTATION_REF_IDX').on(t.refTable, t.refId),
    // Selisih sejak snapshot: dibaca per plant untuk rentang waktu, dan
    // DELTA_PCS ikut di dalam index supaya MySQL tidak perlu menyentuh baris.
    index('TT_STOCK_MUTATION_PLANT_TIME_IDX').on(
      t.plantId,
      t.occurredAt,
      t.partId,
      t.deltaPcs,
    ),
  ],
);

export const stockMutationsRelations = relations(stockMutations, ({ one }) => ({
  part: one(parts, { fields: [stockMutations.partId], references: [parts.id] }),
  plant: one(plants, { fields: [stockMutations.plantId], references: [plants.id] }),
}));

/**
 * Saldo stok beku per tanggal — turunan dari TT_STOCK_MUTATION, bukan sumber
 * kebenaran (aturan 7 tetap berlaku: tidak ada kolom stok yang diedit).
 *
 * Alasannya pengukuran: menjumlahkan seluruh riwayat mutasi tiap kali layar
 * Stok WH dibuka makan 0,5–1,2 detik pada 2 juta baris, dan tabel itu hanya
 * bertambah. Dengan snapshot, layar membaca satu baris per part ditambah
 * mutasi sejak AS_OF saja.
 *
 * AS_OF adalah batas EKSKLUSIF: baris menampung seluruh mutasi dengan
 * OCCURRED_AT < AS_OF pukul 00:00 Asia/Jakarta. Jadi snapshot AS_OF=2026-09-26
 * berarti "saldo pada awal 26 September".
 *
 * ponytail: dikelompokkan per plant+part, bukan per SLOC, karena layar Stok WH
 * memang menjumlahkan seluruh SLOC. Kalau nanti stok perlu dipecah per SLOC,
 * tambahkan kolomnya ke unique index dan ke GROUP BY job-nya.
 */
export const stockSnapshots = mysqlTable(
  'TT_STOCK_SNAPSHOT',
  {
    id: pk(),
    plantId: fk('PLANT_ID')
      .notNull()
      .references(() => plants.id),
    partId: fk('PART_ID')
      .notNull()
      .references(() => parts.id),
    /** Batas eksklusif: mencakup mutasi sebelum tanggal ini (jam pabrik). */
    asOf: date('AS_OF', { mode: 'string' }).notNull(),
    /** Saldo bisa negatif saat konsumsi mendahului pencatatan penerimaan. */
    balancePcs: bigint('BALANCE_PCS', { mode: 'number' }).notNull(),
    mutationCount: bigint('MUTATION_COUNT', { mode: 'number' }).notNull(),
    lastAt: timestamp('LAST_AT'),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    uniqueIndex('TT_STOCK_SNAPSHOT_PLANT_PART_ASOF_UNIQUE').on(t.plantId, t.partId, t.asOf),
    index('TT_STOCK_SNAPSHOT_ASOF_IDX').on(t.asOf),
  ],
);

export const stockSnapshotsRelations = relations(stockSnapshots, ({ one }) => ({
  part: one(parts, { fields: [stockSnapshots.partId], references: [parts.id] }),
  plant: one(plants, { fields: [stockSnapshots.plantId], references: [plants.id] }),
}));
