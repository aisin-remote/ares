import { char, index, int, mysqlTable, timestamp, varchar } from 'drizzle-orm/mysql-core';
import { fk, timestamps } from './_shared';
import { vendors } from './master';

/** Tantangan OTP login supplier; kode mentah hanya hidup singkat di job email. */
export const authChallenges = mysqlTable(
  'TT_AUTH_CHALLENGE',
  {
    id: char('ID', { length: 36 }).primaryKey(),
    vendorId: fk('VENDOR_ID')
      .notNull()
      .references(() => vendors.id, { onDelete: 'cascade' }),
    purpose: varchar('PURPOSE', { length: 32 }).notNull(),
    name: varchar('NAME', { length: 128 }).notNull(),
    email: varchar('EMAIL', { length: 191 }).notNull(),
    // Nama kolom fisik dipertahankan agar perubahan flow tidak memerlukan migrasi
    // destruktif. Isinya sekarang HMAC OTP, bukan secret Authenticator.
    codeHash: varchar('TOTP_SECRET_ENCRYPTED', { length: 512 }).notNull(),
    attempts: int('ATTEMPTS', { unsigned: true }).notNull().default(0),
    expiresAt: timestamp('EXPIRES_AT').notNull(),
    consumedAt: timestamp('CONSUMED_AT'),
    requestIp: varchar('REQUEST_IP', { length: 45 }),
    ...timestamps,
  },
  (t) => [
    index('TT_AUTH_CHALLENGE_EMAIL_IDX').on(t.email, t.expiresAt),
    index('TT_AUTH_CHALLENGE_VENDOR_IDX').on(t.vendorId),
  ],
);
