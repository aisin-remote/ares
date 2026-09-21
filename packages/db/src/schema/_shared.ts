import { bigint, timestamp } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';

/** PK standar: BIGINT UNSIGNED AUTO_INCREMENT — sama dengan konvensi Laravel lama. */
export const pk = () => bigint('ID', { mode: 'number', unsigned: true }).autoincrement().primaryKey();

/** FK standar ke pk() di atas. */
export const fk = (name: string) => bigint(name, { mode: 'number', unsigned: true });

/** created_at / updated_at, penamaan snake_case supaya query SQL manual tetap familiar. */
export const timestamps = {
  createdAt: timestamp('CREATED_AT').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp('UPDATED_AT')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`),
};
