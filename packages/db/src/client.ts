import './load-env';
import mysql from 'mysql2/promise';
import type { Connection } from 'mysql2';
import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from './schema/index';

export type Database = MySql2Database<typeof schema>;
/** Handle di dalam `db.transaction(async (tx) => …)`; dipakai service yang harus ikut transaksi pemanggil. */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

let pool: mysql.Pool | undefined;
let dbInstance: Database | undefined;
let readPool: mysql.Pool | undefined;
let readDbInstance: Database | undefined;

function connectionUrl(variable = 'DATABASE_URL'): string {
  const url = process.env[variable]
    ?? (variable === 'WEB_DATABASE_URL' && process.env.NODE_ENV !== 'production'
      ? process.env.DATABASE_URL
      : undefined);
  if (!url) {
    throw new Error(`${variable} belum diset. Salin .env.example menjadi .env di root repo.`);
  }
  return url;
}

/**
 * Pool dipakai bersama satu proses.
 *
 * Next.js dev me-reload modul tiap perubahan file; tanpa cache di globalThis
 * setiap reload membuka pool baru dan koneksi MySQL cepat habis.
 */
const globalForDb = globalThis as unknown as {
  __aresPool?: mysql.Pool;
  __aresDb?: Database;
  __aresReadPool?: mysql.Pool;
  __aresReadDb?: Database;
};

function createPool(url: string): mysql.Pool {
  const created = mysql.createPool({
    uri: url,
    connectionLimit: Number(process.env.DB_POOL_SIZE ?? 10),
    waitForConnections: true,
    enableKeepAlive: true,
    timezone: 'Z',
    supportBigNumbers: true,
    bigNumberStrings: false,
    dateStrings: ['DATE'],
  });
  created.on('connection', (conn) => {
    (conn as unknown as Connection).query("SET time_zone = '+00:00'", (err) => {
      if (err) console.error('[db] gagal menyetel zona waktu sesi ke UTC:', err.message);
    });
  });
  return created;
}

export function getPool(): mysql.Pool {
  if (globalForDb.__aresPool) return globalForDb.__aresPool;
  if (pool) return pool;

  pool = createPool(connectionUrl());

  /*
   * Setiap koneksi baru dipaksa UTC.
   *
   * Driver membaca kolom waktu dengan anggapan UTC (timezone 'Z' di atas),
   * sedangkan server MySQL memakai zona sistem — di mesin pabrik +07:00.
   * Tanpa baris ini CURRENT_TIMESTAMP tersimpan waktu lokal lalu dibaca tujuh
   * jam ke depan, dan Date yang ditulis aplikasi bergeser ke arah sebaliknya.
   * Aturan repo 6: simpan UTC, tampilkan Asia/Jakarta.
   */
  if (process.env.NODE_ENV !== 'production') globalForDb.__aresPool = pool;
  return pool;
}

/** Koneksi khusus baca untuk Next.js; produksi sebaiknya memakai user MySQL SELECT-only. */
export function getReadDb(): Database {
  if (globalForDb.__aresReadDb) return globalForDb.__aresReadDb;
  if (readDbInstance) return readDbInstance;
  if (!globalForDb.__aresReadPool && !readPool) {
    readPool = createPool(connectionUrl('WEB_DATABASE_URL'));
    if (process.env.NODE_ENV !== 'production') globalForDb.__aresReadPool = readPool;
  }
  readDbInstance = drizzle(globalForDb.__aresReadPool ?? readPool!, { schema, mode: 'default' });
  if (process.env.NODE_ENV !== 'production') globalForDb.__aresReadDb = readDbInstance;
  return readDbInstance;
}

export function getDb(): Database {
  if (globalForDb.__aresDb) return globalForDb.__aresDb;
  if (dbInstance) return dbInstance;

  dbInstance = drizzle(getPool(), { schema, mode: 'default' });
  if (process.env.NODE_ENV !== 'production') globalForDb.__aresDb = dbInstance;
  return dbInstance;
}

export async function closeDb(): Promise<void> {
  const p = globalForDb.__aresPool ?? pool;
  if (p) await p.end();
  const rp = globalForDb.__aresReadPool ?? readPool;
  if (rp && rp !== p) await rp.end();
  globalForDb.__aresPool = undefined;
  globalForDb.__aresDb = undefined;
  pool = undefined;
  dbInstance = undefined;
  globalForDb.__aresReadPool = undefined;
  globalForDb.__aresReadDb = undefined;
  readPool = undefined;
  readDbInstance = undefined;
}
