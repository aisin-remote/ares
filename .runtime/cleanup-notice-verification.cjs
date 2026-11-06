const { getDb, closeDb, users, auditLogs, eq, and } = require('../packages/db/dist/index.js');

async function main() {
  const db = getDb();
  const email = 'account-2632231661@supplier-user.test';
  const npk = 'SUP-TEST-2632231661';
  const [row] = await db.select({ id: users.id, name: users.name }).from(users)
    .where(and(eq(users.email, email), eq(users.npk, npk)));
  if (!row) return console.log('Tidak ada akun uji tertinggal.');
  if (row.name !== 'Supplier User Test') throw new Error('Identitas akun berbeda; pembersihan dihentikan.');
  await db.transaction(async (tx) => {
    await tx.delete(auditLogs).where(and(eq(auditLogs.entity, 'users'), eq(auditLogs.entityId, String(row.id))));
    await tx.delete(users).where(and(eq(users.id, row.id), eq(users.email, email), eq(users.npk, npk)));
  });
  console.log('Satu akun sementara dari tes timeout sudah dibersihkan.');
}
main().finally(closeDb).catch((error) => { console.error(error); process.exitCode = 1; });
