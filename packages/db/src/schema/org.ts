import { mysqlTable, varchar, boolean, uniqueIndex, index, mysqlEnum } from 'drizzle-orm/mysql-core';
import { relations } from 'drizzle-orm';
import { pk, fk, timestamps } from './_shared';
import { vendors } from './master';

/**
 * Pabrik / unit bisnis.
 * Satu baris per pabrik. ARES biasanya satu pabrik; plantId tetap dibawa supaya
 * TT_SAP_OUTBOX dan skema lain punya cakupan yang sama dengan SAP (plant code).
 * Semua tabel operasional membawa plant_id supaya data dua pabrik tidak saling tercampur.
 */
export const plants = mysqlTable(
  'TM_PLANT',
  {
    id: pk(),
    code: varchar('CODE', { length: 32 }).notNull(),
    name: varchar('NAME', { length: 128 }).notNull(),
    isActive: boolean('IS_ACTIVE').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('TM_PLANT_CODE_UNIQUE').on(t.code)],
);

export const roles = mysqlTable(
  'TM_ROLE',
  {
    id: pk(),
    name: varchar('NAME', { length: 64 }).notNull(),
    label: varchar('LABEL', { length: 128 }),
    ...timestamps,
  },
  (t) => [uniqueIndex('TM_ROLE_NAME_UNIQUE').on(t.name)],
);

export const users = mysqlTable(
  'TM_USER',
  {
    id: pk(),
    /** NPK = nomor pokok karyawan. Dipakai sebagai identitas login & jejak scan. */
    npk: varchar('NPK', { length: 32 }).notNull(),
    name: varchar('NAME', { length: 128 }).notNull(),
    email: varchar('EMAIL', { length: 191 }),
    passwordHash: varchar('PASSWORD_HASH', { length: 255 }),
    roleId: fk('ROLE_ID').references(() => roles.id),
    plantId: fk('PLANT_ID').references(() => plants.id),
    /**
     * Terisi hanya untuk akun supplier (PRD §7). Seluruh query portal menyaring
     * dengan nilai ini di lapisan data, bukan dengan menyembunyikan menu
     * (aturan repo 9).
     *
     * ponytail: satu akun = satu kode vendor. Supplier grup yang mengurus dua
     * kode vendor perlu dua akun; kalau itu jadi masalah, jalan naiknya tabel
     * TM_USER_VENDOR, bukan kolom kedua di sini.
     */
    vendorId: fk('VENDOR_ID').references(() => vendors.id),
    isActive: boolean('IS_ACTIVE').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('TM_USER_NPK_UNIQUE').on(t.npk),
    uniqueIndex('TM_USER_EMAIL_UNIQUE').on(t.email),
    index('TM_USER_PLANT_IDX').on(t.plantId),
    index('TM_USER_VENDOR_IDX').on(t.vendorId),
  ],
);

/**
 * Device/terminal scanner di lapangan (barcode gun, RFID reader, panel mesin).
 * Punya kredensial sendiri terpisah dari user — pola ini diambil dari
 * MachineAuthorizationService milik bella dan dipertahankan.
 */
export const devices = mysqlTable(
  'TM_DEVICE',
  {
    id: pk(),
    code: varchar('CODE', { length: 64 }).notNull(),
    name: varchar('NAME', { length: 128 }).notNull(),
    plantId: fk('PLANT_ID').references(() => plants.id),
    kind: mysqlEnum('KIND', ['SCANNER', 'RFID', 'MACHINE_PANEL', 'PRINTER']).notNull(),
    tokenHash: varchar('TOKEN_HASH', { length: 255 }),
    lastSeenAt: varchar('LAST_SEEN_AT', { length: 32 }),
    isActive: boolean('IS_ACTIVE').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('TM_DEVICE_CODE_UNIQUE').on(t.code), index('TM_DEVICE_PLANT_IDX').on(t.plantId)],
);

/**
 * Hak akses per aksi, per peran (PRD §2, F-53, CLAUDE.md aturan 10).
 * ACTION = `picklist.issue`, `picklist.cancel`, `receipt.close`, … Dicek guard
 * di server; disimpan di DB supaya bisa diubah tanpa deploy. Gate per NPK dilarang.
 */
export const permissions = mysqlTable(
  'TM_PERMISSION',
  {
    id: pk(),
    roleId: fk('ROLE_ID')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    action: varchar('ACTION', { length: 64 }).notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex('TM_PERMISSION_ROLE_ACTION_UNIQUE').on(t.roleId, t.action)],
);

export const plantsRelations = relations(plants, ({ many }) => ({
  users: many(users),
  devices: many(devices),
}));

export const usersRelations = relations(users, ({ one }) => ({
  role: one(roles, { fields: [users.roleId], references: [roles.id] }),
  plant: one(plants, { fields: [users.plantId], references: [plants.id] }),
}));

export const devicesRelations = relations(devices, ({ one }) => ({
  plant: one(plants, { fields: [devices.plantId], references: [plants.id] }),
}));

export const permissionsRelations = relations(permissions, ({ one }) => ({
  role: one(roles, { fields: [permissions.roleId], references: [roles.id] }),
}));
