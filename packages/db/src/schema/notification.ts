import { index, int, json, mysqlEnum, mysqlTable, timestamp, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { EMAIL_DELIVERY_STATUSES, PICKLIST_NOTICE_KINDS } from '@ares/contracts';
import { fk, pk, timestamps } from './_shared';
import { picklistHeaders } from './picklist';
import { users } from './org';

/** F-31: satu baris per permintaan email; kirim ulang manual membuat riwayat baru. */
export const emailDeliveries = mysqlTable('TT_EMAIL_DELIVERY', {
  id: pk(),
  picklistId: fk('PICKLIST_ID').notNull().references(() => picklistHeaders.id, { onDelete: 'cascade' }),
  dedupeKey: varchar('DEDUPE_KEY', { length: 100 }).notNull(),
  kind: mysqlEnum('KIND', PICKLIST_NOTICE_KINDS).notNull(),
  status: mysqlEnum('STATUS', EMAIL_DELIVERY_STATUSES).notNull().default('QUEUED'),
  requestedById: fk('REQUESTED_BY_ID').references(() => users.id),
  recipients: json('RECIPIENTS').$type<string[]>().notNull(),
  cc: json('CC').$type<string[]>().notNull(),
  accepted: json('ACCEPTED').$type<string[]>().notNull(),
  attempts: int('ATTEMPTS').notNull().default(0),
  lastError: varchar('LAST_ERROR', { length: 500 }),
  messageId: varchar('MESSAGE_ID', { length: 255 }),
  attemptedAt: timestamp('ATTEMPTED_AT'),
  finishedAt: timestamp('FINISHED_AT'),
  ...timestamps,
}, (t) => [
  uniqueIndex('TT_EMAIL_DELIVERY_DEDUPE_UNIQUE').on(t.dedupeKey),
  index('TT_EMAIL_DELIVERY_PICKLIST_IDX').on(t.picklistId, t.createdAt),
]);
