export * as schema from './schema/index';
export * from './schema/index';
export * from './master-tables';
export { getDb, getPool, closeDb, type Database, type Transaction } from './client';

// Helper query Drizzle yang sering dipakai, di-reexport supaya app tidak perlu
// menambahkan drizzle-orm sebagai dependency langsung.
export {
  eq,
  ne,
  and,
  or,
  not,
  gt,
  gte,
  lt,
  lte,
  like,
  ilike,
  inArray,
  notInArray,
  isNull,
  isNotNull,
  between,
  exists,
  notExists,
  desc,
  asc,
  sql,
  count,
  sum,
  avg,
  max,
  min,
} from 'drizzle-orm';
