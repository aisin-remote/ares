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

function connectionUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL belum diset. Salin .env.example menjadi .env di root repo.');
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
};

export function getPool(): mysql.Pool {
  if (globalForDb.__aresPool) return globalForDb.__aresPool;
  if (pool) return pool;

  pool = mysql.createPool({
    uri: connectionUrl(),
    connectionLimit: Number(process.env.DB_POOL_SIZE ?? 10),
    waitForConnections: true,
    enableKeepAlive: true,
    timezone: 'Z',
    // Angka besar (BIGINT) dikembalikan sebagai string kalau melebihi Number.
    // supportBigNumbers menjaga id tidak terpotong diam-diam.
    supportBigNumbers: true,
    bigNumberStrings: false,
    dateStrings: ['DATE'],
  });

  /*
   * Setiap koneksi baru dipaksa UTC.
   *
   * Driver membaca kolom waktu dengan anggapan UTC (timezone 'Z' di atas),
   * sedangkan server MySQL memakai zona sistem — di mesin pabrik +07:00.
   * Tanpa baris ini CURRENT_TIMESTAMP tersimpan waktu lokal lalu dibaca tujuh
   * jam ke depan, dan Date yang ditulis aplikasi bergeser ke arah sebaliknya.
   * Aturan repo 6: simpan UTC, tampilkan Asia/Jakarta.
   */
  pool.on('connection', (conn) => {
    // Tipenya menjanjikan koneksi versi promise, tetapi mysql2 meneruskan
    // event ini apa adanya dari pool inti — yang datang koneksi gaya callback.
    (conn as unknown as Connection).query("SET time_zone = '+00:00'", (err) => {
      if (err) console.error('[db] gagal menyetel zona waktu sesi ke UTC:', err.message);
    });
  });

  if (process.env.NODE_ENV !== 'production') globalForDb.__aresPool = pool;
  return pool;
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
  globalForDb.__aresPool = undefined;
  globalForDb.__aresDb = undefined;
  pool = undefined;
  dbInstance = undefined;
}
