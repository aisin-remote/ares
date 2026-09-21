import { mysqlTable, varchar, int, timestamp, mysqlEnum, index } from 'drizzle-orm/mysql-core';
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
  ],
);

export const stockMutationsRelations = relations(stockMutations, ({ one }) => ({
  part: one(parts, { fields: [stockMutations.partId], references: [parts.id] }),
  plant: one(plants, { fields: [stockMutations.plantId], references: [plants.id] }),
}));
