import {
  boolean,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { relations } from 'drizzle-orm';
import { MES_RECORD_STATUSES, ORDER_QUEUE_STATUSES } from '@ares/contracts';
import { fk, pk, timestamps } from './_shared';
import { parts, vendorParts } from './master';
import { users } from './org';

/** F-12/F-14: akumulasi kebutuhan per vendor part dan cutoff efektif. */
export const orderQueues = mysqlTable(
  'TT_ORDER_QUEUE',
  {
    id: pk(),
    vendorPartId: fk('VENDOR_PART_ID').notNull().references(() => vendorParts.id),
    cutoffAt: timestamp('CUTOFF_AT').notNull(),
    pcs: int('PCS').notNull().default(0),
    carryOverPcs: int('CARRY_OVER_PCS').notNull().default(0),
    hold: boolean('HOLD').notNull().default(false),
    status: mysqlEnum('STATUS', ORDER_QUEUE_STATUSES).notNull().default('OPEN'),
    /** F-18: alasan cutoff belum dapat menerbitkan picklist, mis. PO item tidak aktif. */
    blockedReason: varchar('BLOCKED_REASON', { length: 1000 }),
    blockedAt: timestamp('BLOCKED_AT'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('TT_ORDER_QUEUE_VENDOR_PART_CUTOFF_UNIQUE').on(t.vendorPartId, t.cutoffAt),
    index('TT_ORDER_QUEUE_STATUS_CUTOFF_IDX').on(t.status, t.cutoffAt),
  ],
);

/** F-10/F-11: satu event per komponen hasil penguraian record produksi. */
export const consumptions = mysqlTable(
  'TT_CONSUMPTION',
  {
    id: pk(),
    sourceKey: varchar('SOURCE_KEY', { length: 191 }).notNull(),
    /** Kunci bersama untuk seluruh komponen dari satu record produksi MES. */
    sourceRecordKey: varchar('SOURCE_RECORD_KEY', { length: 191 }).notNull(),
    parentPartId: fk('PARENT_PART_ID').notNull().references(() => parts.id),
    componentPartId: fk('COMPONENT_PART_ID').notNull().references(() => parts.id),
    qty: int('QTY').notNull(),
    line: varchar('LINE', { length: 32 }).notNull(),
    occurredAt: timestamp('OCCURRED_AT').notNull(),
    queueId: fk('QUEUE_ID').notNull().references(() => orderQueues.id),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('TT_CONSUMPTION_SOURCE_KEY_UNIQUE').on(t.sourceKey),
    index('TT_CONSUMPTION_SOURCE_RECORD_IDX').on(t.sourceRecordKey),
    index('TT_CONSUMPTION_PART_TIME_IDX').on(t.componentPartId, t.occurredAt),
    index('TT_CONSUMPTION_QUEUE_IDX').on(t.queueId),
  ],
);

/** F-13/F-15: koreksi antrean, selalu beralasan dan berjejak user. */
export const queueAdjustments = mysqlTable(
  'TT_QUEUE_ADJUSTMENT',
  {
    id: pk(),
    queueId: fk('QUEUE_ID').notNull().references(() => orderQueues.id),
    deltaPcs: int('DELTA_PCS').notNull(),
    reason: varchar('REASON', { length: 255 }).notNull(),
    userId: fk('USER_ID').notNull().references(() => users.id),
    ...timestamps,
  },
  (t) => [index('TT_QUEUE_ADJUSTMENT_QUEUE_IDX').on(t.queueId)],
);

/** Cursor per sumber MES; disimpan setelah satu halaman selesai diproses. */
export const mesCursors = mysqlTable(
  'TT_MES_CURSOR',
  {
    id: pk(),
    source: varchar('SOURCE', { length: 64 }).notNull(),
    cursor: varchar('CURSOR', { length: 191 }),
    syncedAt: timestamp('SYNCED_AT'),
    ...timestamps,
  },
  (t) => [uniqueIndex('TT_MES_CURSOR_SOURCE_UNIQUE').on(t.source)],
);

/** Input produksi untuk FakeMesGateway; hanya ditulis dari layar /mes. */
export const mesFakeRecords = mysqlTable(
  'TT_MES_FAKE',
  {
    id: pk(),
    recordId: varchar('RECORD_ID', { length: 128 }).notNull(),
    partNo: varchar('PART_NO', { length: 64 }).notNull(),
    qty: int('QTY').notNull(),
    line: varchar('LINE', { length: 32 }).notNull(),
    producedAt: timestamp('PRODUCED_AT').notNull(),
    status: mysqlEnum('STATUS', MES_RECORD_STATUSES).notNull().default('PENDING'),
    error: varchar('ERROR', { length: 1000 }),
    processedAt: timestamp('PROCESSED_AT'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('TT_MES_FAKE_RECORD_ID_UNIQUE').on(t.recordId),
    index('TT_MES_FAKE_STATUS_ID_IDX').on(t.status, t.id),
  ],
);

/** Record HTTP/fake yang gagal sebelum menghasilkan konsumsi. */
export const mesFailures = mysqlTable(
  'TT_MES_FAILURE',
  {
    id: pk(),
    sourceKey: varchar('SOURCE_KEY', { length: 191 }).notNull(),
    recordId: varchar('RECORD_ID', { length: 128 }).notNull(),
    partNo: varchar('PART_NO', { length: 64 }).notNull(),
    qty: int('QTY').notNull(),
    line: varchar('LINE', { length: 32 }).notNull(),
    occurredAt: timestamp('OCCURRED_AT').notNull(),
    error: varchar('ERROR', { length: 1000 }).notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('TT_MES_FAILURE_SOURCE_KEY_UNIQUE').on(t.sourceKey),
    index('TT_MES_FAILURE_TIME_IDX').on(t.occurredAt),
  ],
);

export const orderQueuesRelations = relations(orderQueues, ({ one, many }) => ({
  vendorPart: one(vendorParts, { fields: [orderQueues.vendorPartId], references: [vendorParts.id] }),
  consumptions: many(consumptions),
  adjustments: many(queueAdjustments),
}));

export const consumptionsRelations = relations(consumptions, ({ one }) => ({
  parentPart: one(parts, { fields: [consumptions.parentPartId], references: [parts.id], relationName: 'consumptionParent' }),
  componentPart: one(parts, { fields: [consumptions.componentPartId], references: [parts.id], relationName: 'consumptionComponent' }),
  queue: one(orderQueues, { fields: [consumptions.queueId], references: [orderQueues.id] }),
}));

export const queueAdjustmentsRelations = relations(queueAdjustments, ({ one }) => ({
  queue: one(orderQueues, { fields: [queueAdjustments.queueId], references: [orderQueues.id] }),
  user: one(users, { fields: [queueAdjustments.userId], references: [users.id] }),
}));
