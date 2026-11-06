import '@ares/db';
import { StagingDbService } from './staging-db.service';
import { readStagingConfig } from './staging.config';

/** Diagnostik manual, hanya SELECT; tidak mengaktifkan sinkronisasi. */
async function main() {
  const config = readStagingConfig();
  const db = new StagingDbService();
  try {
    const pool = await db.connect();
    const identity = await pool.request().query('SELECT DB_NAME() AS databaseName');
    const tables = await pool.request().query(`
      SELECT TABLE_SCHEMA AS schemaName, TABLE_NAME AS tableName
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_TYPE = 'BASE TABLE' AND TABLE_NAME IN (
        'TM_VENDOR', 'TM_PARTS', 'TM_VENDOR_PARTS', 'TM_KANBAN',
        'TT_PO_HEADER', 'TT_PO_LINE', 'TT_PURCHASE_RECEIPT_H', 'TT_PURCHASE_RECEIPT_L'
      )
      ORDER BY TABLE_SCHEMA, TABLE_NAME
    `);
    console.log(JSON.stringify({
      connected: true,
      authentication: 'SQL Server Authentication',
      database: identity.recordset[0]?.databaseName,
      pushEnabled: config.STAGING_PUSH_ENABLED,
      pullEnabled: config.STAGING_PULL_ENABLED,
      tables: tables.recordset,
    }, null, 2));
  } finally {
    await db.onModuleDestroy();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Pemeriksaan staging gagal');
  process.exitCode = 1;
});
