import {
  mysqlTable,
  varchar,
  int,
  boolean,
  date,
  time,
  timestamp,
  mysqlEnum,
  uniqueIndex,
  index,
} from 'drizzle-orm/mysql-core';
import { relations } from 'drizzle-orm';
import { ROUNDINGS, SHORT_SHIP_POLICIES, HOLIDAY_SHIFTS } from '@ares/contracts';
import { pk, fk, timestamps } from './_shared';

/**
 * Master supplier, part, vendor part, cutoff, libur, PO cache, dan penomoran
 * (PRD §7, F-01–F-06). Supplier dan part adalah salinan SAP; sebelum sinkron
 * tersedia diisi manual dengan nomor SAP wajib (F-01).
 */

export const vendors = mysqlTable(
  'TM_VENDOR',
  {
    id: pk(),
    sapVendorNo: varchar('SAP_VENDOR_NO', { length: 16 }).notNull(),
    name: varchar('NAME', { length: 128 }).notNull(),
    address: varchar('ADDRESS', { length: 255 }),
    /** Kontak supplier. Email picklist (8.4) dikirim ke akun vendor, bukan ke sini. */
    email: varchar('EMAIL', { length: 191 }),
    isActive: boolean('IS_ACTIVE').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('TM_VENDOR_SAP_NO_UNIQUE').on(t.sapVendorNo)],
);

export const parts = mysqlTable(
  'TM_PARTS',
  {
    id: pk(),
    sapMaterialNo: varchar('SAP_MATERIAL_NO', { length: 40 }).notNull(),
    partNo: varchar('PART_NO', { length: 64 }).notNull(),
    name: varchar('NAME', { length: 128 }).notNull(),
    uom: varchar('UOM', { length: 16 }).notNull().default('PC'),
    isActive: boolean('IS_ACTIVE').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('TM_PARTS_SAP_MATERIAL_UNIQUE').on(t.sapMaterialNo),
    uniqueIndex('TM_PARTS_PART_NO_UNIQUE').on(t.partNo),
  ],
);

/**
 * Cache PO open items dari SAP (F-44). Diisi job sap-sync, dibaca saat
 * picklist terbit (6.6.1); tidak pernah diedit manual.
 */
export const poHeaders = mysqlTable(
  'TT_PO_HEADER',
  {
    id: pk(),
    sapPoNo: varchar('SAP_PO_NO', { length: 16 }).notNull(),
    vendorId: fk('VENDOR_ID')
      .notNull()
      .references(() => vendors.id),
    validFrom: date('VALID_FROM', { mode: 'string' }),
    validTo: date('VALID_TO', { mode: 'string' }),
    ...timestamps,
  },
  (t) => [uniqueIndex('TT_PO_HEADER_SAP_PO_UNIQUE').on(t.sapPoNo), index('TT_PO_HEADER_VENDOR_IDX').on(t.vendorId)],
);

export const poLines = mysqlTable(
  'TT_PO_LINE',
  {
    id: pk(),
    poId: fk('PO_ID')
      .notNull()
      .references(() => poHeaders.id, { onDelete: 'cascade' }),
    /** Nomor item SAP, mis. 00010. */
    item: varchar('ITEM', { length: 8 }).notNull(),
    partId: fk('PART_ID')
      .notNull()
      .references(() => parts.id),
    openQty: int('OPEN_QTY').notNull().default(0),
    syncedAt: timestamp('SYNCED_AT').notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex('TT_PO_LINE_PO_ITEM_UNIQUE').on(t.poId, t.item), index('TT_PO_LINE_PART_IDX').on(t.partId)],
);

/** Part × supplier beserta atribut kanban (F-02). */
export const vendorParts = mysqlTable(
  'TM_VENDOR_PARTS',
  {
    id: pk(),
    partId: fk('PART_ID')
      .notNull()
      .references(() => parts.id),
    vendorId: fk('VENDOR_ID')
      .notNull()
      .references(() => vendors.id),
    qtyPerBox: int('QTY_PER_BOX').notNull(),
    /** Dicetak besar di kanban untuk dibaca operator (F-24). */
    backNo: varchar('BACK_NO', { length: 32 }).notNull(),
    rack: varchar('RACK', { length: 32 }),
    boxType: varchar('BOX_TYPE', { length: 32 }),
    /** PO item yang dipakai saat terbit bila PPIC tidak memilih lain (6.6.1). */
    poItemDefaultId: fk('PO_ITEM_DEFAULT_ID').references(() => poLines.id, { onDelete: 'set null' }),
    isActive: boolean('IS_ACTIVE').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('TM_VENDOR_PARTS_PART_VENDOR_UNIQUE').on(t.partId, t.vendorId),
    index('TM_VENDOR_PARTS_VENDOR_IDX').on(t.vendorId),
  ],
);

/**
 * Jadwal cutoff per supplier (F-04–F-07). Satu baris per jam cutoff; supplier
 * boleh punya beberapa. Jam disimpan sebagai jam pabrik Asia/Jakarta (6.2.1).
 */
export const vendorCutoffs = mysqlTable(
  'TM_VENDOR_CUTOFF',
  {
    id: pk(),
    vendorId: fk('VENDOR_ID')
      .notNull()
      .references(() => vendors.id, { onDelete: 'cascade' }),
    cutoffTime: time('CUTOFF_TIME').notNull(),
    /** Hari kerja ISO (1=Senin … 7=Minggu) dipisah koma; dipakai hitung lead time (6.2.2). */
    workdays: varchar('WORKDAYS', { length: 16 }).notNull().default('1,2,3,4,5'),
    leadDays: int('LEAD_DAYS').notNull().default(1),
    arrivalTime: time('ARRIVAL_TIME').notNull(),
    holidayShift: mysqlEnum('HOLIDAY_SHIFT', HOLIDAY_SHIFTS).notNull().default('BEFORE'),
    shortShipPolicy: mysqlEnum('SHORT_SHIP_POLICY', SHORT_SHIP_POLICIES).notNull().default('CARRY_OVER'),
    rounding: mysqlEnum('ROUNDING', ROUNDINGS).notNull().default('FLOOR'),
    isActive: boolean('IS_ACTIVE').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('TM_VENDOR_CUTOFF_VENDOR_TIME_UNIQUE').on(t.vendorId, t.cutoffTime)],
);

/** Kalender libur pabrik (F-05). */
export const holidays = mysqlTable(
  'TM_HOLIDAY',
  {
    id: pk(),
    date: date('DATE', { mode: 'string' }).notNull(),
    name: varchar('NAME', { length: 128 }).notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex('TM_HOLIDAY_DATE_UNIQUE').on(t.date)],
);

/**
 * Penomoran dokumen (F-21). Baca dengan `SELECT … FOR UPDATE` di dalam
 * transaksi lalu naikkan LAST_NO; bukan MAX()+1. Nomor tidak pernah dipakai
 * ulang, termasuk setelah pembatalan (6.6.2).
 */
export const sequences = mysqlTable(
  'TM_SEQUENCE',
  {
    id: pk(),
    /** Jenis dokumen: PL (picklist), RCP (receipt). */
    code: varchar('CODE', { length: 16 }).notNull(),
    /** yymmdd — berurutan per hari. */
    dateKey: varchar('DATE_KEY', { length: 8 }).notNull(),
    lastNo: int('LAST_NO').notNull().default(0),
    ...timestamps,
  },
  (t) => [uniqueIndex('TM_SEQUENCE_CODE_DATE_UNIQUE').on(t.code, t.dateKey)],
);

export const vendorsRelations = relations(vendors, ({ many }) => ({
  vendorParts: many(vendorParts),
  cutoffs: many(vendorCutoffs),
  pos: many(poHeaders),
}));

export const partsRelations = relations(parts, ({ many }) => ({
  vendorParts: many(vendorParts),
}));

export const vendorPartsRelations = relations(vendorParts, ({ one }) => ({
  part: one(parts, { fields: [vendorParts.partId], references: [parts.id] }),
  vendor: one(vendors, { fields: [vendorParts.vendorId], references: [vendors.id] }),
  poItemDefault: one(poLines, { fields: [vendorParts.poItemDefaultId], references: [poLines.id] }),
}));

export const vendorCutoffsRelations = relations(vendorCutoffs, ({ one }) => ({
  vendor: one(vendors, { fields: [vendorCutoffs.vendorId], references: [vendors.id] }),
}));

export const poHeadersRelations = relations(poHeaders, ({ one, many }) => ({
  vendor: one(vendors, { fields: [poHeaders.vendorId], references: [vendors.id] }),
  lines: many(poLines),
}));

export const poLinesRelations = relations(poLines, ({ one }) => ({
  po: one(poHeaders, { fields: [poLines.poId], references: [poHeaders.id] }),
  part: one(parts, { fields: [poLines.partId], references: [parts.id] }),
}));
