import './load-env';
import bcrypt from 'bcryptjs';
import { getDb, closeDb } from './client';
import { eq, inArray } from 'drizzle-orm';
import {
  plants,
  roles,
  users,
  permissions,
  vendors,
  parts,
  poHeaders,
  poLines,
  vendorParts,
  vendorCutoffs,
} from './schema/index';

/**
 * Seed minimal ARES: satu pabrik, peran sesuai PRD bagian 2, satu admin.
 *
 * Idempoten — aman dijalankan berulang. Data contoh hanya dengan SEED_DEMO=on.
 */
async function main() {
  const db = getDb();
  console.log('[seed] mulai...');

  let plantRows = await db.select().from(plants);
  if (plantRows.length === 0) {
    // Kode pabrik hanya placeholder; ganti lewat layar master atau langsung di DB.
    await db.insert(plants).values([{ code: 'PLANT1', name: 'Pabrik utama' }]);
    plantRows = await db.select().from(plants);
    console.log(`[seed]   + ${plantRows.length} baris ke plants`);
  }
  const plant = mustFind(plantRows, () => true, 'pabrik');

  // ── Peran (PRD bagian 2) ────────────────────────────────────────────────
  await insertMissing('roles', roles, 'name', [
    { name: 'admin', label: 'Admin' },
    { name: 'ppic', label: 'PPIC' },
    { name: 'warehouse', label: 'Warehouse (Receiving)' },
    { name: 'produksi', label: 'Produksi' },
    { name: 'supplier', label: 'Supplier' },
  ]);
  const roleRows = await db.select().from(roles);
  const adminRole = mustFind(roleRows, (r) => r.name === 'admin', 'role admin');

  // ── Permission per aksi (PRD §2, F-53) ──────────────────────────────────
  const roleId = (name: string) => mustFind(roleRows, (r) => r.name === name, `role ${name}`).id;
  await insertMissing(
    'permissions',
    permissions,
    ['roleId', 'action'],
    [
      { roleId: roleId('admin'), action: 'picklist.issue' },
      { roleId: roleId('admin'), action: 'picklist.cancel' },
      { roleId: roleId('ppic'), action: 'picklist.issue' },
      { roleId: roleId('ppic'), action: 'picklist.cancel' },
      /*
       * Membaca picklist pun butuh izin, bukan sekadar token yang sah. Tanpa
       * baris-baris ini, token device scanner yang berumur setahun ikut bisa
       * menarik seluruh riwayat order semua supplier.
       *
       * Peran supplier tetap dibatasi datanya oleh VENDOR_ID di lapisan query
       * (aturan repo 9); izin ini hanya menentukan 'boleh membuka layarnya'.
       */
      { roleId: roleId('admin'), action: 'picklist.read' },
      { roleId: roleId('ppic'), action: 'picklist.read' },
      { roleId: roleId('warehouse'), action: 'picklist.read' },
      { roleId: roleId('supplier'), action: 'picklist.read' },
      // F-30: konfirmasi kirim hanya oleh akun supplier (6.3.4: setelah SHIPPED lewat PPIC).
      { roleId: roleId('supplier'), action: 'picklist.ship' },
      // Sesi scan kedatangan (F-34–F-37): operator gudang, admin sebagai cadangan.
      { roleId: roleId('warehouse'), action: 'receipt.open' },
      { roleId: roleId('warehouse'), action: 'receipt.scan' },
      { roleId: roleId('warehouse'), action: 'receipt.close' },
      { roleId: roleId('warehouse'), action: 'receipt.cancel' },
      { roleId: roleId('admin'), action: 'receipt.open' },
      { roleId: roleId('admin'), action: 'receipt.scan' },
      { roleId: roleId('admin'), action: 'receipt.close' },
      { roleId: roleId('admin'), action: 'receipt.cancel' },
      // Pemantauan dan kontrol outbox SAP (F-46–F-48).
      { roleId: roleId('admin'), action: 'outbox.read' },
      { roleId: roleId('admin'), action: 'outbox.collect' },
      { roleId: roleId('admin'), action: 'outbox.retry' },
      { roleId: roleId('admin'), action: 'outbox.hold' },
      { roleId: roleId('ppic'), action: 'outbox.read' },
      { roleId: roleId('ppic'), action: 'outbox.collect' },
      { roleId: roleId('ppic'), action: 'outbox.retry' },
      { roleId: roleId('ppic'), action: 'outbox.hold' },
      // F-01–F-09: master hanya untuk PPIC/Admin; pengelolaan user khusus Admin.
      { roleId: roleId('admin'), action: 'master.read' },
      { roleId: roleId('admin'), action: 'master.write' },
      { roleId: roleId('admin'), action: 'setting.write' },
      { roleId: roleId('admin'), action: 'user.write' },
      { roleId: roleId('ppic'), action: 'master.read' },
      { roleId: roleId('ppic'), action: 'master.write' },
      { roleId: roleId('ppic'), action: 'setting.write' },
      // F-42: penyesuaian stok WH manual oleh PPIC (admin sebagai cadangan).
      { roleId: roleId('admin'), action: 'stock.adjust' },
      { roleId: roleId('ppic'), action: 'stock.adjust' },
    ],
  );

  // ── User admin ──────────────────────────────────────────────────────────
  const existingAdmin = await db.select().from(users).where(eq(users.npk, 'ADMIN')).limit(1);
  if (existingAdmin.length === 0) {
    await db.insert(users).values({
      npk: 'ADMIN',
      name: 'Administrator',
      email: null,
      // Ganti setelah login pertama.
      passwordHash: await bcrypt.hash('admin123', 10),
      roleId: adminRole.id,
      plantId: plant.id,
    });
    console.log('[seed]   + user ADMIN (password: admin123)');
  }

  // ── Master contoh (F-01, F-02, F-04) ────────────────────────────────────
  // Demo selalu opt-in agar seed produksi tidak menyisipkan master/PO contoh.
  if (process.env.SEED_DEMO === 'on') {
    await seedMasterContoh();
    await seedAkunSupplier(plant.id, roleId('supplier'));
  } else {
    console.log('[seed]   data demo dilewati (aktifkan dengan SEED_DEMO=on)');
  }

  console.log('[seed] selesai');
  await closeDb();
}

/**
 * Akun portal untuk supplier contoh pertama.
 *
 * Supplier masuk dengan email, bukan NPK; NPK tetap diisi karena kolomnya NOT
 * NULL dan unik — dipakai kode vendor supaya tetap punya arti di jejak audit.
 * Password contoh sama polanya dengan admin: ganti setelah login pertama.
 */
async function seedAkunSupplier(plantId: number, supplierRoleId: number): Promise<void> {
  const db = getDb();
  const demoVendors = await db
    .select({ id: vendors.id, name: vendors.name, email: vendors.email, no: vendors.sapVendorNo })
    .from(vendors)
    .where(inArray(vendors.sapVendorNo, ['0000100231', '0000100544']));
  for (const vendor of demoVendors) {
    if (!vendor.email) continue;
    const ada = await db.select().from(users).where(eq(users.email, vendor.email)).limit(1);
    if (ada.length > 0) continue;
    await db.insert(users).values({
      npk: `SUP-${vendor.no}`,
      name: vendor.name,
      email: vendor.email,
      passwordHash: await bcrypt.hash('supplier123', 10),
      roleId: supplierRoleId,
      plantId,
      vendorId: vendor.id,
    });
    console.log(`[seed]   + akun supplier ${vendor.email} (password: supplier123)`);
  }
}

/**
 * Master contoh supaya alur order manual (F-17) bisa dicoba di layar: dua
 * supplier, empat part, PO yang masih terbuka, dan jadwal cutoff.
 *
 * ponytail: TT_PO_HEADER/TT_PO_LINE sebenarnya milik job sap-sync (F-44) dan
 * tidak boleh diisi tangan. Tapi tanpa baris PO setiap order ditolak 422
 * karena line tanpa PO item tidak boleh terbit (6.6.1, F-18) — layar picklist
 * mustahil dicoba sebelum gateway SAP ada. Hapus blok PO begitu sap-sync jalan.
 */
async function seedMasterContoh(): Promise<void> {
  const db = getDb();

  await insertMissing('vendors', vendors, 'sapVendorNo', [
    {
      sapVendorNo: '0000100231',
      name: 'PT Sinar Logam Presisi',
      address: 'Kawasan Industri Jababeka II Blok C-14, Cikarang',
      email: 'ppc@sinarlogam.co.id',
    },
    {
      sapVendorNo: '0000100544',
      name: 'PT Karya Rubber Nusantara',
      address: 'Jl. Raya Narogong KM 12, Bekasi',
      email: 'sales@karyarubber.co.id',
    },
  ]);

  await insertMissing('parts', parts, 'partNo', [
    { sapMaterialNo: '10004715', partNo: '48609-0K040', name: 'BRACKET, SHOCK ABSORBER FR' },
    { sapMaterialNo: '10004832', partNo: '53801-0K180', name: 'PANEL, FENDER FR RH' },
    { sapMaterialNo: '10005120', partNo: '90312-38013', name: 'SEAL, OIL REAR AXLE' },
    { sapMaterialNo: '10005233', partNo: '67867-0K010', name: 'WEATHERSTRIP, FR DOOR RH' },
  ]);

  const vendorRows = await db.select().from(vendors);
  const partRows = await db.select().from(parts);
  const vendorId = (no: string) =>
    mustFind(vendorRows, (v) => v.sapVendorNo === no, `vendor ${no}`).id;
  const partId = (no: string) => mustFind(partRows, (p) => p.partNo === no, `part ${no}`).id;

  /*
   * Rentang PO dibuat mengelilingi tahun berjalan supaya seed tidak
   * kedaluwarsa sendiri: pickPoItem menolak PO yang tidak meliputi tanggal
   * kirim, dan order gagal total dengan pesan yang membingungkan.
   */
  const tahun = new Date().getFullYear();
  const validFrom = `${tahun - 1}-01-01`;
  const validTo = `${tahun + 1}-12-31`;

  await insertMissing('poHeaders', poHeaders, 'sapPoNo', [
    { sapPoNo: '4500128877', vendorId: vendorId('0000100231'), validFrom, validTo },
    { sapPoNo: '4500128901', vendorId: vendorId('0000100544'), validFrom, validTo },
  ]);

  const poRows = await db.select().from(poHeaders);
  const poId = (no: string) => mustFind(poRows, (p) => p.sapPoNo === no, `PO ${no}`).id;
  const syncedAt = new Date();

  await insertMissing(
    'poLines',
    poLines,
    ['poId', 'item'],
    [
      {
        poId: poId('4500128877'),
        item: '00010',
        partId: partId('48609-0K040'),
        openQty: 12000,
        syncedAt,
      },
      {
        poId: poId('4500128877'),
        item: '00020',
        partId: partId('53801-0K180'),
        openQty: 4800,
        syncedAt,
      },
      {
        poId: poId('4500128901'),
        item: '00010',
        partId: partId('90312-38013'),
        openQty: 30000,
        syncedAt,
      },
      {
        poId: poId('4500128901'),
        item: '00020',
        partId: partId('67867-0K010'),
        openQty: 9000,
        syncedAt,
      },
    ],
  );

  await insertMissing(
    'vendorParts',
    vendorParts,
    ['partId', 'vendorId'],
    [
      {
        partId: partId('48609-0K040'),
        vendorId: vendorId('0000100231'),
        qtyPerBox: 60,
        backNo: 'A-12',
        rack: 'R-01-A',
        boxType: 'BOX_PLASTIK_L',
      },
      {
        partId: partId('53801-0K180'),
        vendorId: vendorId('0000100231'),
        qtyPerBox: 24,
        backNo: 'A-13',
        rack: 'R-01-B',
        boxType: 'PALLET_BESI',
      },
      {
        partId: partId('90312-38013'),
        vendorId: vendorId('0000100544'),
        qtyPerBox: 200,
        backNo: 'B-07',
        rack: 'R-04-C',
        boxType: 'BOX_PLASTIK_S',
      },
      {
        partId: partId('67867-0K010'),
        vendorId: vendorId('0000100544'),
        qtyPerBox: 100,
        backNo: 'B-08',
        rack: 'R-04-D',
        boxType: 'BOX_PLASTIK_S',
      },
    ],
  );

  // Jam ditulis HH:MM:SS penuh — MySQL mengembalikan TIME dalam bentuk itu,
  // dan insertMissing membandingkan kuncinya sebagai teks.
  await insertMissing(
    'vendorCutoffs',
    vendorCutoffs,
    ['vendorId', 'cutoffTime'],
    [
      { vendorId: vendorId('0000100231'), cutoffTime: '10:00:00', arrivalTime: '14:00:00' },
      { vendorId: vendorId('0000100231'), cutoffTime: '15:00:00', arrivalTime: '08:00:00' },
      { vendorId: vendorId('0000100544'), cutoffTime: '09:00:00', arrivalTime: '13:00:00' },
    ],
  );
}

async function insertMissing<
  TTable extends { [K in TKey]: unknown },
  TKey extends string,
  TValues extends Record<string, unknown>,
>(
  label: string,
  table: TTable,
  /*
   * Kolom penentu "sudah ada". Boleh beberapa kolom sekaligus, karena sebagian
   * kode memang berulang antar pabrik: SLOC WH00 ada di setiap pabrik, persis
   * seperti di SAP. Dengan satu kolom saja, pabrik kedua akan dilewati diam-diam.
   */
  keyColumn: TKey | TKey[],
  values: TValues[],
): Promise<void> {
  const db = getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyTable = table as any;
  const cols = Array.isArray(keyColumn) ? keyColumn : [keyColumn];
  const keyOf = (row: Record<string, unknown>) => cols.map((c) => String(row[c])).join('\u0000');
  const existing: Array<Record<string, unknown>> = await db.select().from(anyTable);
  const existingKeys = new Set(existing.map(keyOf));
  const toInsert = values.filter((v) => !existingKeys.has(keyOf(v)));
  if (toInsert.length === 0) return;
  await db.insert(anyTable).values(toInsert);
  console.log(`[seed]   + ${toInsert.length} baris ke ${label}`);
}

function mustFind<T>(rows: T[], pred: (row: T) => boolean, label: string): T {
  const found = rows.find(pred);
  if (!found) throw new Error(`seed: ${label} tidak ditemukan`);
  return found;
}

main().catch(async (err) => {
  console.error('[seed] gagal:', err);
  await closeDb();
  process.exit(1);
});
