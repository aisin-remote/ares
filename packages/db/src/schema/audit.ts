import { relations } from 'drizzle-orm';
import { index, json, mysqlTable, timestamp, varchar } from 'drizzle-orm/mysql-core';
import { fk, pk, timestamps } from './_shared';
import { users } from './org';

/** F-09/F-54: jejak perubahan yang ditulis dalam transaksi yang sama. */
export const auditLogs = mysqlTable(
  'TT_AUDIT_LOG',
  {
    id: pk(),
    entity: varchar('ENTITY', { length: 64 }).notNull(),
    // String juga menampung ID kanban ULID saat F-54 dipakai modul lain.
    entityId: varchar('ENTITY_ID', { length: 64 }).notNull(),
    action: varchar('ACTION', { length: 32 }).notNull(),
    userId: fk('USER_ID').notNull().references(() => users.id),
    before: json('BEFORE'),
    after: json('AFTER'),
    at: timestamp('AT').notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [index('TT_AUDIT_LOG_ENTITY_IDX').on(t.entity, t.entityId, t.at)],
);

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  user: one(users, { fields: [auditLogs.userId], references: [users.id] }),
}));
