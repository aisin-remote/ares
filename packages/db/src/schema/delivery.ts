import {
  mysqlTable,
  varchar,
  int,
  boolean,
  time,
  uniqueIndex,
  index,
  check,
} from 'drizzle-orm/mysql-core';
import { relations, sql } from 'drizzle-orm';
import { pk, fk, timestamps } from './_shared';
import { plants } from './org';

/**
 * Jadwal kedatangan supplier yang berulang setiap minggu.
 *
 * SUPPLIER_LABEL sengaja berupa teks: sumber operasional belum memuat nomor
 * vendor SAP dan satu slot milk run dapat membawa beberapa supplier sekaligus.
 * Data ini tidak boleh membuat TM_VENDOR dengan nomor SAP rekaan.
 */
export const deliverySchedules = mysqlTable(
  'TM_DELIVERY_SCHEDULE',
  {
    id: pk(),
    plantId: fk('PLANT_ID')
      .notNull()
      .references(() => plants.id, { onDelete: 'cascade' }),
    supplierLabel: varchar('SUPPLIER_LABEL', { length: 255 }).notNull(),
    /** Satu atau beberapa kode vendor, dipisahkan koma untuk slot milk run. */
    supplierCodes: varchar('SUPPLIER_CODES', { length: 255 }).notNull(),
    truckStation: varchar('TRUCK_STATION', { length: 64 }).notNull(),
    /** Hari ISO: 1=Senin sampai 7=Minggu. */
    dayOfWeek: int('DAY_OF_WEEK').notNull(),
    arrivalTime: time('ARRIVAL_TIME').notNull(),
    /** Lama blok pada diagram sumber, dalam menit. */
    durationMinutes: int('DURATION_MINUTES').notNull().default(120),
    sourceKey: varchar('SOURCE_KEY', { length: 191 }).notNull(),
    isActive: boolean('IS_ACTIVE').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('TM_DELIVERY_SCHEDULE_SOURCE_UNIQUE').on(t.sourceKey),
    index('TM_DELIVERY_SCHEDULE_PLANT_DAY_IDX').on(t.plantId, t.dayOfWeek, t.arrivalTime),
    check('TM_DELIVERY_SCHEDULE_DAY_CHECK', sql`${t.dayOfWeek} between 1 and 7`),
    check('TM_DELIVERY_SCHEDULE_DURATION_CHECK', sql`${t.durationMinutes} between 1 and 1440`),
  ],
);

export const deliverySchedulesRelations = relations(deliverySchedules, ({ one }) => ({
  plant: one(plants, { fields: [deliverySchedules.plantId], references: [plants.id] }),
}));
