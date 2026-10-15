import {
  mysqlTable,
  varchar,
  int,
  date,
  time,
  timestamp,
  mysqlEnum,
  uniqueIndex,
  index,
} from 'drizzle-orm/mysql-core';
import { relations } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
  PICKLIST_STATUSES,
  PICKLIST_TYPES,
  PICKLIST_LINE_STATUSES,
  KANBAN_STATUSES,
  KANBAN_EVENT_TYPES,
  RECEIPT_STATUSES,
  SCAN_RESULTS,
} from '@ares/contracts';
import { pk, fk, timestamps } from './_shared';
import { plants, users, devices } from './org';
import { vendors, vendorParts } from './master';

/**
 * Picklist → kanban → sesi scan (receipt). PRD §3 siklus hidup, §7 kolom.
 *
 * Status di kolom hanyalah keadaan saat ini; transisinya diputuskan fungsi di
 * packages/domain (6.4, 6.5), bukan di sini.
 */

export const picklistHeaders = mysqlTable(
  'TT_PICKLIST_H',
  {
    id: pk(),
    /** UUID untuk URL/API; BIGINT tetap dipakai sebagai FK internal. */
    publicId: varchar('PUBLIC_ID', { length: 36 }).notNull().$defaultFn(() => randomUUID()),
    plantId: fk('PLANT_ID')
      .notNull()
      .references(() => plants.id),
    /** Format plant+YYMMDD+running+recovery, mis. 826092300100. */
    picklistNo: varchar('PICKLIST_NO', { length: 32 }).notNull(),
    /** Revisi (F-25) memakai nomor yang sama; hanya memuat line yang belum diterima. */
    revision: int('REVISION').notNull().default(0),
    type: mysqlEnum('TYPE', PICKLIST_TYPES).notNull(),
    vendorId: fk('VENDOR_ID')
      .notNull()
      .references(() => vendors.id),
    /** Cutoff yang melahirkan picklist ini (UTC). Order manual mengisi cutoff/cycle pilihan PPIC (F-17). */
    cutoffAt: timestamp('CUTOFF_AT').notNull(),
    deliveryDate: date('DELIVERY_DATE', { mode: 'string' }).notNull(),
    arrivalTime: time('ARRIVAL_TIME').notNull(),
    /**
     * Kedatangan ke-n dalam satu hari untuk supplier ini (§14), disalin saat
     * terbit. Tidak dihitung ulang saat cetak ulang: jadwal cutoff boleh
     * berubah, kartu yang sudah beredar tidak (F-23, F-24).
     */
    cycle: int('CYCLE').notNull().default(1),
    status: mysqlEnum('STATUS', PICKLIST_STATUSES).notNull().default('ISSUED'),
    /** Diisi worker begitu kedua PDF selesai dirender dan tersimpan (F-27). */
    pdfReadyAt: timestamp('PDF_READY_AT'),
    /** Unduhan pertama supplier (F-29). */
    downloadedAt: timestamp('DOWNLOADED_AT'),
    /** F-08: terisi saat worker pertama kali mengambil pengingat jenis ini. */
    downloadReminderAt: timestamp('DOWNLOAD_REMINDER_AT'),
    shippedAt: timestamp('SHIPPED_AT'),
    confirmReminderAt: timestamp('CONFIRM_REMINDER_AT'),
    eta: timestamp('ETA'),
    vehicleNo: varchar('VEHICLE_NO', { length: 32 }),
    note: varchar('NOTE', { length: 255 }),
    createdById: fk('CREATED_BY_ID').references(() => users.id),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('TT_PICKLIST_H_PUBLIC_ID_UNIQUE').on(t.publicId),
    uniqueIndex('TT_PICKLIST_H_NO_REV_UNIQUE').on(t.picklistNo, t.revision),
    index('TT_PICKLIST_H_VENDOR_STATUS_IDX').on(t.vendorId, t.status),
    index('TT_PICKLIST_H_STATUS_DELIVERY_IDX').on(t.status, t.deliveryDate),
  ],
);

export const picklistLines = mysqlTable(
  'TT_PICKLIST_L',
  {
    id: pk(),
    picklistId: fk('PICKLIST_ID')
      .notNull()
      .references(() => picklistHeaders.id, { onDelete: 'cascade' }),
    vendorPartId: fk('VENDOR_PART_ID')
      .notNull()
      .references(() => vendorParts.id),
    boxOrdered: int('BOX_ORDERED').notNull(),
    /** Diisi saat supplier konfirmasi kirim (F-30); NULL = belum konfirmasi. */
    boxShipped: int('BOX_SHIPPED'),
    boxReceived: int('BOX_RECEIVED').notNull().default(0),
    /** Snapshot saat terbit — master boleh berubah, dokumen tidak. */
    qtyPerBox: int('QTY_PER_BOX').notNull(),
    pcs: int('PCS').notNull(),
    /** PO item SAP yang berlaku pada tanggal kirim; tanpa ini line tidak terbit (6.6.1, F-18). */
    sapPoNo: varchar('SAP_PO_NO', { length: 16 }).notNull(),
    sapPoItem: varchar('SAP_PO_ITEM', { length: 8 }).notNull(),
    status: mysqlEnum('STATUS', PICKLIST_LINE_STATUSES).notNull().default('OPEN'),
    ...timestamps,
  },
  (t) => [
    // Satu vendor part satu baris per picklist (6.1.5).
    uniqueIndex('TT_PICKLIST_L_PICKLIST_VP_UNIQUE').on(t.picklistId, t.vendorPartId),
    index('TT_PICKLIST_L_VENDOR_PART_IDX').on(t.vendorPartId),
  ],
);

/**
 * Sesi scan kedatangan = receipt (F-34, 6.5.3). Dibuka dengan barcode picklist
 * (OPEN), ditutup menjadi CLOSED. Nomor diberikan saat dibuka supaya satu
 * nilai menjadi ID sesi, nomor receipt, dan kunci idempoten GR (F-47).
 */
export const receiptHeaders = mysqlTable(
  'TT_RECEIPT_H',
  {
    id: pk(),
    /** UUID untuk URL/API; BIGINT tetap dipakai sebagai FK internal. */
    publicId: varchar('PUBLIC_ID', { length: 36 }).notNull().$defaultFn(() => randomUUID()),
    plantId: fk('PLANT_ID')
      .notNull()
      .references(() => plants.id),
    /** Dari TM_SEQUENCE, mis. RCP-260918-0007. */
    receiptNo: varchar('RECEIPT_NO', { length: 32 }).notNull(),
    picklistId: fk('PICKLIST_ID')
      .notNull()
      .references(() => picklistHeaders.id),
    deviceId: fk('DEVICE_ID').references(() => devices.id),
    status: mysqlEnum('STATUS', RECEIPT_STATUSES).notNull().default('OPEN'),
    closedAt: timestamp('CLOSED_AT'),
    /** Yang menutup sesi. */
    userId: fk('USER_ID').references(() => users.id),
    /** Alasan bila ada kanban kurang (F-37); wajib saat PARTIAL. */
    note: varchar('NOTE', { length: 255 }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('TT_RECEIPT_H_PUBLIC_ID_UNIQUE').on(t.publicId),
    uniqueIndex('TT_RECEIPT_H_NO_UNIQUE').on(t.receiptNo),
    index('TT_RECEIPT_H_PICKLIST_STATUS_IDX').on(t.picklistId, t.status),
  ],
);

export const receiptLines = mysqlTable(
  'TT_RECEIPT_L',
  {
    id: pk(),
    receiptId: fk('RECEIPT_ID')
      .notNull()
      .references(() => receiptHeaders.id, { onDelete: 'cascade' }),
    picklistLineId: fk('PICKLIST_LINE_ID')
      .notNull()
      .references(() => picklistLines.id),
    boxReceived: int('BOX_RECEIVED').notNull(),
    pcsReceived: int('PCS_RECEIVED').notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex('TT_RECEIPT_L_RECEIPT_LINE_UNIQUE').on(t.receiptId, t.picklistLineId)],
);

/**
 * Satu box (F-22). ID = ULID dan itulah isi QR `ARES:K:<ID>` (8.3); sekali
 * pakai, berakhir di RECEIVED. Dibuat saat picklist terbit, satu per box.
 */
export const kanbans = mysqlTable(
  'TM_KANBAN',
  {
    id: varchar('ID', { length: 26 }).primaryKey(),
    picklistLineId: fk('PICKLIST_LINE_ID')
      .notNull()
      .references(() => picklistLines.id),
    /** Urutan tercetak per picklist, mis. 3/12. */
    serial: int('SERIAL').notNull(),
    status: mysqlEnum('STATUS', KANBAN_STATUSES).notNull().default('PRINTED'),
    /** Sesi yang menerimanya — pembeda "sudah discan di sesi ini" vs "di sesi lain" (6.4). */
    receiptId: fk('RECEIPT_ID').references(() => receiptHeaders.id),
    receivedAt: timestamp('RECEIVED_AT'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('TM_KANBAN_LINE_SERIAL_UNIQUE').on(t.picklistLineId, t.serial),
    index('TM_KANBAN_STATUS_IDX').on(t.status),
  ],
);

/** Jejak kanban, append-only: tidak pernah di-UPDATE/DELETE. */
export const kanbanEvents = mysqlTable(
  'TT_KANBAN_EVENT',
  {
    id: pk(),
    kanbanId: varchar('KANBAN_ID', { length: 26 })
      .notNull()
      .references(() => kanbans.id),
    type: mysqlEnum('TYPE', KANBAN_EVENT_TYPES).notNull(),
    userId: fk('USER_ID').references(() => users.id),
    deviceId: fk('DEVICE_ID').references(() => devices.id),
    occurredAt: timestamp('OCCURRED_AT').notNull(),
    /** Dokumen pemicu: nomor picklist-revisi atau nomor receipt. */
    ref: varchar('REF', { length: 64 }),
    createdAt: timestamps.createdAt,
  },
  (t) => [index('TT_KANBAN_EVENT_KANBAN_IDX').on(t.kanbanId, t.occurredAt)],
);

/** Setiap scan di sesi kedatangan, termasuk yang ditolak (F-36, F-38). Append-only. */
export const scanEvents = mysqlTable(
  'TT_SCAN_EVENT',
  {
    id: pk(),
    /**
     * `<sessionId>:<code>` untuk semua hasil — satu kode hanya tercatat sekali
     * per sesi (F-38); scan ulang dijawab dari keadaan kanban (6.4), bukan
     * ditulis lagi.
     */
    dedupeKey: varchar('DEDUPE_KEY', { length: 128 }).notNull(),
    sessionId: fk('SESSION_ID')
      .notNull()
      .references(() => receiptHeaders.id),
    code: varchar('CODE', { length: 64 }).notNull(),
    result: mysqlEnum('RESULT', SCAN_RESULTS).notNull(),
    message: varchar('MESSAGE', { length: 255 }),
    userId: fk('USER_ID').references(() => users.id),
    deviceId: fk('DEVICE_ID').references(() => devices.id),
    occurredAt: timestamp('OCCURRED_AT').notNull(),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    uniqueIndex('TT_SCAN_EVENT_DEDUPE_UNIQUE').on(t.dedupeKey),
    index('TT_SCAN_EVENT_SESSION_IDX').on(t.sessionId, t.occurredAt),
  ],
);

export const picklistHeadersRelations = relations(picklistHeaders, ({ one, many }) => ({
  plant: one(plants, { fields: [picklistHeaders.plantId], references: [plants.id] }),
  vendor: one(vendors, { fields: [picklistHeaders.vendorId], references: [vendors.id] }),
  createdBy: one(users, { fields: [picklistHeaders.createdById], references: [users.id] }),
  lines: many(picklistLines),
  receipts: many(receiptHeaders),
}));

export const picklistLinesRelations = relations(picklistLines, ({ one, many }) => ({
  picklist: one(picklistHeaders, {
    fields: [picklistLines.picklistId],
    references: [picklistHeaders.id],
  }),
  vendorPart: one(vendorParts, {
    fields: [picklistLines.vendorPartId],
    references: [vendorParts.id],
  }),
  kanbans: many(kanbans),
}));

export const receiptHeadersRelations = relations(receiptHeaders, ({ one, many }) => ({
  plant: one(plants, { fields: [receiptHeaders.plantId], references: [plants.id] }),
  picklist: one(picklistHeaders, {
    fields: [receiptHeaders.picklistId],
    references: [picklistHeaders.id],
  }),
  device: one(devices, { fields: [receiptHeaders.deviceId], references: [devices.id] }),
  user: one(users, { fields: [receiptHeaders.userId], references: [users.id] }),
  lines: many(receiptLines),
  scans: many(scanEvents),
}));

export const receiptLinesRelations = relations(receiptLines, ({ one }) => ({
  receipt: one(receiptHeaders, {
    fields: [receiptLines.receiptId],
    references: [receiptHeaders.id],
  }),
  picklistLine: one(picklistLines, {
    fields: [receiptLines.picklistLineId],
    references: [picklistLines.id],
  }),
}));

export const kanbansRelations = relations(kanbans, ({ one, many }) => ({
  picklistLine: one(picklistLines, {
    fields: [kanbans.picklistLineId],
    references: [picklistLines.id],
  }),
  receipt: one(receiptHeaders, { fields: [kanbans.receiptId], references: [receiptHeaders.id] }),
  events: many(kanbanEvents),
}));

export const kanbanEventsRelations = relations(kanbanEvents, ({ one }) => ({
  kanban: one(kanbans, { fields: [kanbanEvents.kanbanId], references: [kanbans.id] }),
  user: one(users, { fields: [kanbanEvents.userId], references: [users.id] }),
  device: one(devices, { fields: [kanbanEvents.deviceId], references: [devices.id] }),
}));

export const scanEventsRelations = relations(scanEvents, ({ one }) => ({
  session: one(receiptHeaders, { fields: [scanEvents.sessionId], references: [receiptHeaders.id] }),
}));
