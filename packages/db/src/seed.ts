import './load-env';
import bcrypt from 'bcryptjs';
import { getDb, closeDb } from './client';
import { and, eq } from 'drizzle-orm';
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
  devices,
  deliverySchedules,
  orderQueues,
  consumptions,
  queueAdjustments,
  picklistHeaders,
  picklistLines,
  kanbans,
  kanbanEvents,
  receiptHeaders,
  receiptLines,
  scanEvents,
} from './schema/index';
import { REAL_DELIVERY_SCHEDULES } from './delivery-schedule-data';
import { REAL_SUPPLIERS } from './supplier-list-data';
import { ELECTRIC_SUPPLIERS } from './electric-supplier-data';

const ALL_SUPPLIERS = [...REAL_SUPPLIERS, ...ELECTRIC_SUPPLIERS] as const;

/**
 * Seed minimal ARES: tiga area pabrik, jadwal receiving riil, peran sesuai
 * PRD bagian 2, dan satu admin.
 *
 * Idempoten — aman dijalankan berulang. Data contoh hanya dengan SEED_DEMO=on.
 */
async function main() {
  const db = getDb();
  console.log('[seed] mulai...');

  let plantRows = await db.select().from(plants);
  const legacyPlant = plantRows.find((row) => row.code === 'PLANT1');
  if (legacyPlant && !plantRows.some((row) => row.code === 'UNIT')) {
    // Pertahankan ID agar user, device, picklist, dan histori lokal tetap terhubung.
    await db
      .update(plants)
      .set({ code: 'UNIT', name: 'Unit Plant' })
      .where(eq(plants.id, legacyPlant.id));
  }
  await insertMissing('plants', plants, 'code', [
    { code: 'UNIT', name: 'Unit Plant' },
    { code: 'BODY', name: 'Body Plant' },
    { code: 'ELECTRIC', name: 'Electric Plant' },
  ]);
  plantRows = await db.select().from(plants);
  const plant = mustFind(plantRows, (row) => row.code === 'UNIT', 'pabrik UNIT');

  const plantId = (code: string) =>
    mustFind(plantRows, (row) => row.code === code, `pabrik ${code}`).id;
  await syncDeliverySchedules(
    REAL_DELIVERY_SCHEDULES.map((row) => ({
      plantId: plantId(row.plantCode),
      supplierLabel: row.supplierLabel,
      supplierCodes: row.supplierCodes,
      truckStation: row.truckStation,
      dayOfWeek: row.dayOfWeek,
      arrivalTime: row.arrivalTime,
      durationMinutes: row.durationMinutes,
      sourceKey: row.sourceKey,
    })),
  );
  const supplierIds = await syncSupplierListVendors(
    ALL_SUPPLIERS.map((row) => ({
      ...row,
      plantId: plantId(row.plantCode),
    })),
    plantId('UNIT'),
  );
  await syncSupplierCutoffTemplates(ALL_SUPPLIERS, supplierIds);

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
      { roleId: roleId('admin'), action: 'picklist.override' },
      { roleId: roleId('ppic'), action: 'picklist.override' },
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
      // Supplier mengelola atribut kemasan vendor part-nya sendiri (back no, rak, tipe box).
      { roleId: roleId('supplier'), action: 'vendorPart.self' },
      { roleId: roleId('admin'), action: 'receipt.read' },
      { roleId: roleId('ppic'), action: 'receipt.read' },
      { roleId: roleId('warehouse'), action: 'receipt.read' },
      // Sesi scan kedatangan (F-34–F-37): operator gudang, admin sebagai cadangan.
      { roleId: roleId('warehouse'), action: 'receipt.open' },
      { roleId: roleId('warehouse'), action: 'receipt.scan' },
      { roleId: roleId('warehouse'), action: 'receipt.close' },
      { roleId: roleId('admin'), action: 'receipt.open' },
      { roleId: roleId('admin'), action: 'receipt.scan' },
      { roleId: roleId('admin'), action: 'receipt.close' },
      { roleId: roleId('admin'), action: 'receipt.cancel' },
      { roleId: roleId('ppic'), action: 'receipt.cancel' },
      // Pemantauan dan kontrol outbox SAP (F-46–F-48).
      { roleId: roleId('admin'), action: 'outbox.read' },
      { roleId: roleId('admin'), action: 'outbox.collect' },
      { roleId: roleId('admin'), action: 'outbox.retry' },
      { roleId: roleId('admin'), action: 'outbox.hold' },
      { roleId: roleId('ppic'), action: 'outbox.read' },
      { roleId: roleId('ppic'), action: 'outbox.collect' },
      { roleId: roleId('ppic'), action: 'outbox.retry' },
      { roleId: roleId('ppic'), action: 'outbox.hold' },
      // F-01–F-09: master untuk PPIC/Admin; PPIC hanya mengelola akun supplier.
      { roleId: roleId('admin'), action: 'master.read' },
      { roleId: roleId('admin'), action: 'master.write' },
      { roleId: roleId('admin'), action: 'setting.write' },
      { roleId: roleId('admin'), action: 'user.write' },
      { roleId: roleId('ppic'), action: 'master.read' },
      { roleId: roleId('ppic'), action: 'master.write' },
      { roleId: roleId('ppic'), action: 'setting.write' },
      { roleId: roleId('ppic'), action: 'user.write' },
      // F-42: penyesuaian stok WH manual oleh PPIC (admin sebagai cadangan).
      { roleId: roleId('admin'), action: 'stock.adjust' },
      { roleId: roleId('ppic'), action: 'stock.adjust' },
      { roleId: roleId('admin'), action: 'stock.read' },
      { roleId: roleId('ppic'), action: 'stock.read' },
      { roleId: roleId('warehouse'), action: 'stock.read' },
      // F-10–F-12: pemantauan MES serta jalur push manual saat integrasi ditest.
      { roleId: roleId('admin'), action: 'mes.read' },
      { roleId: roleId('admin'), action: 'mes.write' },
      { roleId: roleId('admin'), action: 'consumption.push' },
      { roleId: roleId('ppic'), action: 'mes.read' },
      { roleId: roleId('ppic'), action: 'mes.write' },
      { roleId: roleId('ppic'), action: 'consumption.push' },
      { roleId: roleId('admin'), action: 'queue.write' },
      { roleId: roleId('ppic'), action: 'queue.write' },
      { roleId: roleId('admin'), action: 'realtime.read' },
      { roleId: roleId('ppic'), action: 'realtime.read' },
      { roleId: roleId('warehouse'), action: 'realtime.read' },
    ],
  );
  // F-40 menetapkan pembatalan receipt untuk PPIC; hapus grant lama yang
  // sempat diberikan ke warehouse pada seed versi awal.
  await db
    .delete(permissions)
    .where(
      and(eq(permissions.roleId, roleId('warehouse')), eq(permissions.action, 'receipt.cancel')),
    );

  // ── User admin ──────────────────────────────────────────────────────────
  const existingAdmin = await db.select().from(users).where(eq(users.npk, 'ADMIN')).limit(1);
  if (existingAdmin.length === 0) {
    const adminPassword =
      process.env.ADMIN_INITIAL_PASSWORD?.trim() ||
      (process.env.NODE_ENV === 'production' ? '' : 'admin123');
    if (
      process.env.NODE_ENV === 'production' &&
      (adminPassword.length < 15 || bcryptByteLength(adminPassword) > 72)
    ) {
      throw new Error('seed: ADMIN_INITIAL_PASSWORD wajib 15–72 byte di produksi');
    }
    await db.insert(users).values({
      npk: 'ADMIN',
      name: 'Administrator',
      email: null,
      // Ganti setelah login pertama.
      passwordHash: await bcrypt.hash(adminPassword, Number(process.env.BCRYPT_ROUNDS ?? 12)),
      roleId: adminRole.id,
      plantId: plant.id,
    });
    console.log(
      process.env.NODE_ENV === 'production'
        ? '[seed]   + user ADMIN (password dari ADMIN_INITIAL_PASSWORD)'
        : `[seed]   + user ADMIN (password: ${adminPassword})`,
    );
  }

  // Monitor receiving memakai kredensial perangkat, terpisah dari sesi user.
  // Produksi hanya membuatnya bila token diisi eksplisit; demo mendapat token
  // sederhana agar alur pairing bisa langsung diuji.
  const displayToken =
    process.env.DISPLAY_DEVICE_TOKEN?.trim() ||
    (process.env.NODE_ENV !== 'production' && process.env.SEED_DEMO === 'on' ? 'monitor123' : '');
  if (displayToken) {
    if (
      process.env.NODE_ENV === 'production' &&
      (displayToken.length < 32 || bcryptByteLength(displayToken) > 72)
    )
      throw new Error('seed: DISPLAY_DEVICE_TOKEN wajib 32–72 byte di produksi');
    const displayCode = process.env.DISPLAY_DEVICE_CODE?.trim() || 'RECEIVING-TV-01';
    const existingDisplay = await db
      .select({ id: devices.id })
      .from(devices)
      .where(eq(devices.code, displayCode))
      .limit(1);
    if (!existingDisplay[0]) {
      await db.insert(devices).values({
        code: displayCode,
        name: 'Monitor Receiving',
        plantId: plant.id,
        kind: 'MACHINE_PANEL',
        tokenHash: await bcrypt.hash(displayToken, Number(process.env.BCRYPT_ROUNDS ?? 12)),
      });
      console.log(`[seed]   + device ${displayCode}`);
    }
  }

  // ── Master contoh (F-01, F-02, F-04) ────────────────────────────────────
  // Demo selalu opt-in agar seed produksi tidak menyisipkan master/PO contoh.
  if (process.env.SEED_DEMO === 'on') {
    await seedMasterContoh(plant.id);
    const internalPassword =
      process.env.DEMO_INTERNAL_PASSWORD?.trim() ||
      (process.env.NODE_ENV === 'production' ? '' : 'user123');
    const supplierPassword =
      process.env.DEMO_SUPPLIER_PASSWORD?.trim() ||
      (process.env.NODE_ENV === 'production' ? '' : 'supplier123');
    if (
      process.env.NODE_ENV === 'production' &&
      (internalPassword.length < 15 || bcryptByteLength(internalPassword) > 72)
    )
      throw new Error('seed: DEMO_INTERNAL_PASSWORD wajib 15–72 byte untuk demo produksi');
    if (
      process.env.NODE_ENV === 'production' &&
      (supplierPassword.length < 15 || bcryptByteLength(supplierPassword) > 72)
    )
      throw new Error('seed: DEMO_SUPPLIER_PASSWORD wajib 15–72 byte untuk demo produksi');
    const rounds = Number(process.env.BCRYPT_ROUNDS ?? 12);
    await seedAkunInternal(plant.id, roleId, await bcrypt.hash(internalPassword, rounds));
    await seedAkunSupplier(roleId('supplier'), await bcrypt.hash(supplierPassword, rounds));
    await seedFlowContoh(plant.id);
  } else {
    console.log('[seed]   data demo dilewati (aktifkan dengan SEED_DEMO=on)');
  }

  console.log('[seed] selesai');
  await closeDb();
}

/** Satu akun uji untuk setiap role internal selain admin yang sudah dibuat di atas. */
async function seedAkunInternal(
  plantId: number,
  roleId: (name: string) => number,
  passwordHash: string,
): Promise<void> {
  await insertMissing('users', users, 'npk', [
    { npk: 'PPIC01', name: 'PPIC Demo', passwordHash, roleId: roleId('ppic'), plantId },
    { npk: 'GUDANG01', name: 'Warehouse Demo', passwordHash, roleId: roleId('warehouse'), plantId },
    { npk: 'PRODUKSI01', name: 'Produksi Demo', passwordHash, roleId: roleId('produksi'), plantId },
  ]);
}

/**
 * Satu akun portal untuk setiap vendor. Login selalu berupa email yang mudah
 * ditebak dari kode vendor, sementara email kontak pada TM_VENDOR tidak diubah.
 */
async function seedAkunSupplier(supplierRoleId: number, passwordHash: string): Promise<void> {
  const db = getDb();
  const vendorRows = await db
    .select({
      id: vendors.id,
      name: vendors.name,
      plantId: vendors.plantId,
      scheduleCode: vendors.scheduleCode,
      sapVendorNo: vendors.sapVendorNo,
    })
    .from(vendors);
  const userRows = await db.select().from(users);
  const codes = vendorRows.map((vendor) => vendorLoginCode(vendor));
  if (new Set(codes).size !== codes.length)
    throw new Error('seed: kode login vendor bentrok setelah dinormalisasi');

  const seededByVendor = new Map(
    userRows
      .filter((user) => user.vendorId != null && user.npk.startsWith('SUP-'))
      .map((user) => [user.vendorId!, user]),
  );
  const emailOwners = new Map(
    userRows.filter((user) => user.email).map((user) => [user.email!.toLowerCase(), user]),
  );
  let inserted = 0;
  let updated = 0;

  for (let index = 0; index < vendorRows.length; index += 1) {
    const vendor = vendorRows[index]!;
    const email = `${codes[index]}@aiia.co.id`;
    const emailOwner = emailOwners.get(email);
    if (emailOwner && emailOwner.vendorId !== vendor.id)
      throw new Error(`seed: email vendor ${email} sudah dipakai user lain`);

    const seeded = emailOwner ?? seededByVendor.get(vendor.id);
    if (seeded) {
      // Pertahankan password yang mungkin sudah diganti, tetapi rapikan akun
      // hasil seed lama ke identitas vendor dan pola email terbaru.
      await db
        .update(users)
        .set({
          name: vendor.name,
          email,
          roleId: supplierRoleId,
          plantId: vendor.plantId,
          vendorId: vendor.id,
        })
        .where(eq(users.id, seeded.id));
      updated += 1;
      continue;
    }

    await db.insert(users).values({
      npk: `SUP-${vendor.id}`,
      name: vendor.name,
      email,
      passwordHash,
      roleId: supplierRoleId,
      plantId: vendor.plantId,
      vendorId: vendor.id,
    });
    inserted += 1;
  }
  console.log(
    `[seed]   ${vendorRows.length} akun supplier disinkronkan (${inserted} baru, ${updated} diperbarui)`,
  );
}

function vendorLoginCode(vendor: {
  id: number;
  scheduleCode: string | null;
  sapVendorNo: string | null;
}): string {
  const normalized = (vendor.scheduleCode || vendor.sapVendorNo || `vendor_${vendor.id}`)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
  return normalized || `vendor_${vendor.id}`;
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
async function seedMasterContoh(plantId: number): Promise<void> {
  const db = getDb();

  await insertMissing('vendors', vendors, 'sapVendorNo', [
    {
      sapVendorNo: '0000100231',
      plantId,
      name: 'PT Sinar Logam Presisi',
      address: 'Kawasan Industri Jababeka II Blok C-14, Cikarang',
      email: 'ppc@sinarlogam.co.id',
    },
    {
      sapVendorNo: '0000100544',
      plantId,
      name: 'PT Karya Rubber Nusantara',
      address: 'Jl. Raya Narogong KM 12, Bekasi',
      email: 'sales@karyarubber.co.id',
    },
  ]);

  await insertMissing('parts', parts, 'partNo', [
    { sapMaterialNo: 'FG1000001', partNo: 'FG-DEMO-001', name: 'UNIT ASSY DEMO AVICENNA' },
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

type DemoPicklistStatus = typeof picklistHeaders.$inferInsert.status;
type DemoPicklistLineStatus = typeof picklistLines.$inferInsert.status;
type DemoKanbanStatus = typeof kanbans.$inferInsert.status;

type DemoPicklistSpec = {
  seed: number;
  publicId: string;
  picklistNo: string;
  revision: number;
  vendorId: number;
  deliveryDate: string;
  arrivalTime: string;
  status: DemoPicklistStatus;
  downloadedAt: Date | null;
  shippedAt: Date | null;
  eta: Date | null;
  vehicleNo: string | null;
  note: string;
  lines: Array<{
    vendorPartId: number;
    boxOrdered: number;
    boxShipped: number | null;
    boxReceived: number;
    qtyPerBox: number;
    sapPoNo: string;
    sapPoItem: string;
    status: DemoPicklistLineStatus;
    kanbans: DemoKanbanStatus[];
  }>;
};

/**
 * Snapshot demo end-to-end dari scan Avicenna sampai receiving. Semua natural
 * key memakai prefix DEMO/nomor 900x agar seed ulang tidak menyentuh transaksi.
 */
async function seedFlowContoh(plantId: number): Promise<void> {
  const db = getDb();
  const now = new Date();
  const today = jakartaDate(0);
  const yesterday = jakartaDate(-1);
  const tomorrow = jakartaDate(1);
  const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
  const later = (minutes: number) => new Date(now.getTime() + minutes * 60_000);

  const vendorRows = await db.select().from(vendors);
  const partRows = await db.select().from(parts);
  const vendorA = mustFind(
    vendorRows,
    (row) => row.sapVendorNo === '0000100231',
    'vendor demo logam',
  );
  const vendorB = mustFind(
    vendorRows,
    (row) => row.sapVendorNo === '0000100544',
    'vendor demo rubber',
  );
  const parentPart = mustFind(
    partRows,
    (row) => row.partNo === 'FG-DEMO-001',
    'finished good demo',
  );
  const partByNo = (partNo: string) =>
    mustFind(partRows, (row) => row.partNo === partNo, `part ${partNo}`);
  const vendorPartRows = await db.select().from(vendorParts);
  const vp = (vendorId: number, partNo: string) => {
    const part = partByNo(partNo);
    return mustFind(
      vendorPartRows,
      (row) => row.vendorId === vendorId && row.partId === part.id,
      `vendor part ${partNo}`,
    );
  };
  const vpA1 = vp(vendorA.id, '48609-0K040');
  const vpA2 = vp(vendorA.id, '53801-0K180');
  const vpB1 = vp(vendorB.id, '90312-38013');
  const vpB2 = vp(vendorB.id, '67867-0K010');

  const ppic = mustFind(
    await db.select().from(users),
    (row) => row.npk === 'PPIC01',
    'user PPIC demo',
  );
  const warehouse = mustFind(
    await db.select().from(users),
    (row) => row.npk === 'GUDANG01',
    'user warehouse demo',
  );
  const [display] = await db
    .select({ id: devices.id })
    .from(devices)
    .where(eq(devices.code, process.env.DISPLAY_DEVICE_CODE?.trim() || 'RECEIVING-TV-01'))
    .limit(1);

  const queueRows = [
    {
      sourceKey: 'DEMO-AVICENNA-SCAN-001',
      sourceRecordKey: 'DEMO-AVICENNA-BATCH-001',
      vendorPart: vpA1,
      pcs: 180,
      consumedPcs: 120,
      cutoffAt: ago(45),
      line: 'MP-PRD-01',
    },
    {
      sourceKey: 'DEMO-AVICENNA-SCAN-002',
      sourceRecordKey: 'DEMO-AVICENNA-BATCH-001',
      vendorPart: vpA2,
      pcs: 72,
      consumedPcs: 72,
      cutoffAt: ago(45),
      line: 'MP-PRD-01',
    },
    {
      sourceKey: 'DEMO-AVICENNA-SCAN-003',
      sourceRecordKey: 'DEMO-AVICENNA-BATCH-002',
      vendorPart: vpB1,
      pcs: 400,
      consumedPcs: 400,
      cutoffAt: later(240),
      line: 'MP-PRD-02',
    },
  ];

  for (const row of queueRows) {
    const [existingConsumption] = await db
      .select({ queueId: consumptions.queueId })
      .from(consumptions)
      .where(eq(consumptions.sourceKey, row.sourceKey))
      .limit(1);
    let queueId = existingConsumption?.queueId;
    if (queueId) {
      await db
        .update(orderQueues)
        .set({
          cutoffAt: row.cutoffAt,
          pcs: row.pcs,
          carryOverPcs: 0,
          hold: false,
          status: 'OPEN',
          blockedReason: null,
          blockedAt: null,
        })
        .where(eq(orderQueues.id, queueId));
    } else {
      queueId = (
        await db
          .insert(orderQueues)
          .values({
            vendorPartId: row.vendorPart.id,
            cutoffAt: row.cutoffAt,
            pcs: row.pcs,
          })
          .$returningId()
      )[0]!.id;
      await db.insert(consumptions).values({
        sourceKey: row.sourceKey,
        sourceRecordKey: row.sourceRecordKey,
        parentPartId: parentPart.id,
        componentPartId: row.vendorPart.partId,
        qty: row.consumedPcs,
        line: row.line,
        occurredAt: ago(90),
        queueId,
      });
    }
    if (row.sourceKey === 'DEMO-AVICENNA-SCAN-001') {
      const reason = '[DEMO] PPIC tambah safety stock 1 kanban';
      const [adjustment] = await db
        .select({ id: queueAdjustments.id })
        .from(queueAdjustments)
        .where(and(eq(queueAdjustments.queueId, queueId), eq(queueAdjustments.reason, reason)))
        .limit(1);
      if (!adjustment)
        await db.insert(queueAdjustments).values({
          queueId,
          deltaPcs: 60,
          reason,
          userId: ppic.id,
        });
    }
  }

  const picklists: DemoPicklistSpec[] = [
    {
      seed: 1,
      publicId: '10000000-0000-4000-8000-000000000001',
      picklistNo: 'PL-261020-9001',
      revision: 0,
      vendorId: vendorA.id,
      deliveryDate: tomorrow,
      arrivalTime: '09:00:00',
      status: 'ISSUED',
      downloadedAt: null,
      shippedAt: null,
      eta: null,
      vehicleNo: null,
      note: '[DEMO 1/7] Order baru — siap dilihat dan diunduh supplier',
      lines: [
        {
          vendorPartId: vpA1.id,
          boxOrdered: 3,
          boxShipped: null,
          boxReceived: 0,
          qtyPerBox: 60,
          sapPoNo: '4500128877',
          sapPoItem: '00010',
          status: 'OPEN',
          kanbans: ['PRINTED', 'PRINTED', 'PRINTED'],
        },
        {
          vendorPartId: vpA2.id,
          boxOrdered: 2,
          boxShipped: null,
          boxReceived: 0,
          qtyPerBox: 24,
          sapPoNo: '4500128877',
          sapPoItem: '00020',
          status: 'OPEN',
          kanbans: ['PRINTED', 'PRINTED'],
        },
      ],
    },
    {
      seed: 2,
      publicId: '10000000-0000-4000-8000-000000000002',
      picklistNo: 'PL-261020-9002',
      revision: 0,
      vendorId: vendorA.id,
      deliveryDate: tomorrow,
      arrivalTime: '10:30:00',
      status: 'DOWNLOADED',
      downloadedAt: ago(120),
      shippedAt: null,
      eta: null,
      vehicleNo: null,
      note: '[DEMO 2/7] Dokumen sudah diunduh — menunggu konfirmasi kirim',
      lines: [
        {
          vendorPartId: vpA1.id,
          boxOrdered: 2,
          boxShipped: null,
          boxReceived: 0,
          qtyPerBox: 60,
          sapPoNo: '4500128877',
          sapPoItem: '00010',
          status: 'OPEN',
          kanbans: ['PRINTED', 'PRINTED'],
        },
      ],
    },
    {
      seed: 3,
      publicId: '10000000-0000-4000-8000-000000000003',
      picklistNo: 'PL-261020-9003',
      revision: 0,
      vendorId: vendorA.id,
      deliveryDate: today,
      arrivalTime: '13:00:00',
      status: 'SHIPPED',
      downloadedAt: ago(240),
      shippedAt: ago(90),
      eta: later(90),
      vehicleNo: 'B 9123 DEM',
      note: '[DEMO 3/7] Barang sedang menuju pabrik',
      lines: [
        {
          vendorPartId: vpA2.id,
          boxOrdered: 3,
          boxShipped: 3,
          boxReceived: 0,
          qtyPerBox: 24,
          sapPoNo: '4500128877',
          sapPoItem: '00020',
          status: 'OPEN',
          kanbans: ['SHIPPED', 'SHIPPED', 'SHIPPED'],
        },
      ],
    },
    {
      seed: 4,
      publicId: '10000000-0000-4000-8000-000000000004',
      picklistNo: 'PL-261020-9004',
      revision: 0,
      vendorId: vendorA.id,
      deliveryDate: today,
      arrivalTime: '14:00:00',
      status: 'SHIPPED',
      downloadedAt: ago(300),
      shippedAt: ago(150),
      eta: later(120),
      vehicleNo: 'B 9456 DEM',
      note: '[DEMO 4/7] Kirim parsial 2 dari 4 box; sisa menjadi recovery rev 1',
      lines: [
        {
          vendorPartId: vpA1.id,
          boxOrdered: 4,
          boxShipped: 2,
          boxReceived: 0,
          qtyPerBox: 60,
          sapPoNo: '4500128877',
          sapPoItem: '00010',
          status: 'SHORT',
          kanbans: ['SHIPPED', 'SHIPPED'],
        },
      ],
    },
    {
      seed: 5,
      publicId: '10000000-0000-4000-8000-000000000005',
      picklistNo: 'PL-261020-9004',
      revision: 1,
      vendorId: vendorA.id,
      deliveryDate: tomorrow,
      arrivalTime: '14:00:00',
      status: 'ISSUED',
      downloadedAt: null,
      shippedAt: null,
      eta: null,
      vehicleNo: null,
      note: '[DEMO 4/7] Order Sheet recovery — sisa 2 box dari revisi 0',
      lines: [
        {
          vendorPartId: vpA1.id,
          boxOrdered: 2,
          boxShipped: null,
          boxReceived: 0,
          qtyPerBox: 60,
          sapPoNo: '4500128877',
          sapPoItem: '00010',
          status: 'OPEN',
          kanbans: ['PRINTED', 'PRINTED'],
        },
      ],
    },
    {
      seed: 6,
      publicId: '10000000-0000-4000-8000-000000000006',
      picklistNo: 'PL-261020-9005',
      revision: 0,
      vendorId: vendorA.id,
      deliveryDate: today,
      arrivalTime: '11:00:00',
      status: 'SHIPPED',
      downloadedAt: ago(360),
      shippedAt: ago(180),
      eta: ago(15),
      vehicleNo: 'B 9789 DEM',
      note: '[DEMO 5/7] Receiving aktif — 1 dari 3 kanban sudah discan',
      lines: [
        {
          vendorPartId: vpA2.id,
          boxOrdered: 3,
          boxShipped: 3,
          boxReceived: 0,
          qtyPerBox: 24,
          sapPoNo: '4500128877',
          sapPoItem: '00020',
          status: 'OPEN',
          kanbans: ['RECEIVED', 'SHIPPED', 'SHIPPED'],
        },
      ],
    },
    {
      seed: 7,
      publicId: '10000000-0000-4000-8000-000000000007',
      picklistNo: 'PL-261020-9006',
      revision: 0,
      vendorId: vendorA.id,
      deliveryDate: yesterday,
      arrivalTime: '15:00:00',
      status: 'PARTIAL',
      downloadedAt: ago(1_500),
      shippedAt: ago(1_350),
      eta: ago(1_260),
      vehicleNo: 'B 9006 DEM',
      note: '[DEMO 6/7] Receipt parsial — 2 diterima, 1 kanban kurang',
      lines: [
        {
          vendorPartId: vpA1.id,
          boxOrdered: 3,
          boxShipped: 3,
          boxReceived: 2,
          qtyPerBox: 60,
          sapPoNo: '4500128877',
          sapPoItem: '00010',
          status: 'OPEN',
          kanbans: ['RECEIVED', 'RECEIVED', 'MISSING'],
        },
      ],
    },
    {
      seed: 8,
      publicId: '10000000-0000-4000-8000-000000000008',
      picklistNo: 'PL-261020-9007',
      revision: 0,
      vendorId: vendorA.id,
      deliveryDate: yesterday,
      arrivalTime: '16:00:00',
      status: 'COMPLETE',
      downloadedAt: ago(1_600),
      shippedAt: ago(1_450),
      eta: ago(1_380),
      vehicleNo: 'B 9007 DEM',
      note: '[DEMO 7/7] Semua kanban diterima lengkap',
      lines: [
        {
          vendorPartId: vpA1.id,
          boxOrdered: 2,
          boxShipped: 2,
          boxReceived: 2,
          qtyPerBox: 60,
          sapPoNo: '4500128877',
          sapPoItem: '00010',
          status: 'RECEIVED',
          kanbans: ['RECEIVED', 'RECEIVED'],
        },
        {
          vendorPartId: vpA2.id,
          boxOrdered: 1,
          boxShipped: 1,
          boxReceived: 1,
          qtyPerBox: 24,
          sapPoNo: '4500128877',
          sapPoItem: '00020',
          status: 'RECEIVED',
          kanbans: ['RECEIVED'],
        },
      ],
    },
  ];

  const seeded = new Map<number, Awaited<ReturnType<typeof upsertDemoPicklist>>>();
  for (const spec of picklists)
    seeded.set(spec.seed, await upsertDemoPicklist(spec, plantId, ppic.id, now));

  await upsertDemoReceipt(
    {
      publicId: '20000000-0000-4000-8000-000000000005',
      receiptNo: 'RCP-261020-9005',
      status: 'OPEN',
      closedAt: null,
      note: null,
      picklist: seeded.get(6)!,
    },
    plantId,
    warehouse.id,
    display?.id ?? null,
    ago(10),
  );
  await upsertDemoReceipt(
    {
      publicId: '20000000-0000-4000-8000-000000000006',
      receiptNo: 'RCP-261020-9006',
      status: 'CLOSED',
      closedAt: ago(60),
      note: '1 box belum tiba; tindak lanjut supplier',
      picklist: seeded.get(7)!,
    },
    plantId,
    warehouse.id,
    display?.id ?? null,
    ago(60),
  );
  await upsertDemoReceipt(
    {
      publicId: '20000000-0000-4000-8000-000000000007',
      receiptNo: 'RCP-261020-9007',
      status: 'CLOSED',
      closedAt: ago(30),
      note: null,
      picklist: seeded.get(8)!,
    },
    plantId,
    warehouse.id,
    display?.id ?? null,
    ago(30),
  );

  console.log('[seed]   flow demo lengkap: antrean, 8 Order Sheet/recovery, dan 3 receipt');
}

async function upsertDemoPicklist(
  spec: DemoPicklistSpec,
  plantId: number,
  createdById: number,
  now: Date,
) {
  const db = getDb();
  const headerValues = {
    publicId: spec.publicId,
    plantId,
    picklistNo: spec.picklistNo,
    revision: spec.revision,
    type: 'AUTO' as const,
    vendorId: spec.vendorId,
    cutoffAt: new Date(now.getTime() - 6 * 60 * 60_000),
    deliveryDate: spec.deliveryDate,
    arrivalTime: spec.arrivalTime,
    cycle: 1,
    status: spec.status,
    downloadedAt: spec.downloadedAt,
    shippedAt: spec.shippedAt,
    eta: spec.eta,
    vehicleNo: spec.vehicleNo,
    note: spec.note,
    createdById,
  };
  let [header] = await db
    .select({ id: picklistHeaders.id })
    .from(picklistHeaders)
    .where(
      and(
        eq(picklistHeaders.picklistNo, spec.picklistNo),
        eq(picklistHeaders.revision, spec.revision),
      ),
    )
    .limit(1);
  if (header)
    await db.update(picklistHeaders).set(headerValues).where(eq(picklistHeaders.id, header.id));
  else {
    const id = (await db.insert(picklistHeaders).values(headerValues).$returningId())[0]!.id;
    header = { id };
  }

  const resultLines: Array<{
    id: number;
    qtyPerBox: number;
    kanbans: Array<{ id: string; status: DemoKanbanStatus }>;
  }> = [];
  let serial = 0;
  for (let lineIndex = 0; lineIndex < spec.lines.length; lineIndex += 1) {
    const line = spec.lines[lineIndex]!;
    const lineValues = {
      picklistId: header.id,
      vendorPartId: line.vendorPartId,
      boxOrdered: line.boxOrdered,
      boxShipped: line.boxShipped,
      boxReceived: line.boxReceived,
      qtyPerBox: line.qtyPerBox,
      pcs: line.boxOrdered * line.qtyPerBox,
      sapPoNo: line.sapPoNo,
      sapPoItem: line.sapPoItem,
      status: line.status,
    };
    let [lineRow] = await db
      .select({ id: picklistLines.id })
      .from(picklistLines)
      .where(
        and(
          eq(picklistLines.picklistId, header.id),
          eq(picklistLines.vendorPartId, line.vendorPartId),
        ),
      )
      .limit(1);
    if (lineRow)
      await db.update(picklistLines).set(lineValues).where(eq(picklistLines.id, lineRow.id));
    else {
      const id = (await db.insert(picklistLines).values(lineValues).$returningId())[0]!.id;
      lineRow = { id };
    }

    const resultKanbans: Array<{ id: string; status: DemoKanbanStatus }> = [];
    for (let index = 0; index < line.kanbans.length; index += 1) {
      serial += 1;
      const status = line.kanbans[index]!;
      const id = demoKanbanId(spec.seed * 100 + lineIndex * 10 + index + 1);
      const [existing] = await db
        .select({ id: kanbans.id })
        .from(kanbans)
        .where(eq(kanbans.id, id))
        .limit(1);
      const values = {
        picklistLineId: lineRow.id,
        serial,
        status,
        receiptId: null,
        receivedAt: null,
      };
      if (existing) await db.update(kanbans).set(values).where(eq(kanbans.id, id));
      else await db.insert(kanbans).values({ id, ...values });
      const ref = `${spec.picklistNo}-${spec.revision}`;
      await ensureKanbanEvent(
        id,
        'PRINTED',
        ref,
        createdById,
        new Date(now.getTime() - 7 * 60 * 60_000),
      );
      if (status !== 'PRINTED')
        await ensureKanbanEvent(id, 'SHIPPED', ref, null, spec.shippedAt ?? now);
      resultKanbans.push({ id, status });
    }
    resultLines.push({ id: lineRow.id, qtyPerBox: line.qtyPerBox, kanbans: resultKanbans });
  }
  return { id: header.id, lines: resultLines };
}

async function upsertDemoReceipt(
  spec: {
    publicId: string;
    receiptNo: string;
    status: typeof receiptHeaders.$inferInsert.status;
    closedAt: Date | null;
    note: string | null;
    picklist: Awaited<ReturnType<typeof upsertDemoPicklist>>;
  },
  plantId: number,
  warehouseUserId: number,
  deviceId: number | null,
  occurredAt: Date,
): Promise<void> {
  const db = getDb();
  const values = {
    publicId: spec.publicId,
    plantId,
    receiptNo: spec.receiptNo,
    picklistId: spec.picklist.id,
    deviceId,
    status: spec.status,
    closedAt: spec.closedAt,
    userId: spec.status === 'CLOSED' ? warehouseUserId : null,
    note: spec.note,
  };
  let [receipt] = await db
    .select({ id: receiptHeaders.id })
    .from(receiptHeaders)
    .where(eq(receiptHeaders.receiptNo, spec.receiptNo))
    .limit(1);
  if (receipt) await db.update(receiptHeaders).set(values).where(eq(receiptHeaders.id, receipt.id));
  else {
    const id = (await db.insert(receiptHeaders).values(values).$returningId())[0]!.id;
    receipt = { id };
  }

  for (const line of spec.picklist.lines) {
    const received = line.kanbans.filter((row) => row.status === 'RECEIVED');
    const missing = line.kanbans.filter((row) => row.status === 'MISSING');
    for (const kanban of received) {
      await db
        .update(kanbans)
        .set({
          status: 'RECEIVED',
          receiptId: receipt.id,
          receivedAt: occurredAt,
        })
        .where(eq(kanbans.id, kanban.id));
      const code = `ARES:K:${kanban.id}`;
      await insertMissing('scanEvents', scanEvents, 'dedupeKey', [
        {
          dedupeKey: `${receipt.id}:${code}`,
          sessionId: receipt.id,
          code,
          result: 'OK',
          message: 'Kanban diterima (data demo)',
          userId: warehouseUserId,
          deviceId,
          occurredAt,
        },
      ]);
      await ensureKanbanEvent(
        kanban.id,
        'RECEIVED',
        spec.receiptNo,
        warehouseUserId,
        occurredAt,
        deviceId,
      );
    }
    for (const kanban of missing) {
      await ensureKanbanEvent(
        kanban.id,
        'MISSING',
        spec.receiptNo,
        warehouseUserId,
        occurredAt,
        deviceId,
      );
    }
    if (spec.status === 'CLOSED' && received.length > 0) {
      const lineValues = {
        receiptId: receipt.id,
        picklistLineId: line.id,
        boxReceived: received.length,
        pcsReceived: received.length * line.qtyPerBox,
      };
      const [existing] = await db
        .select({ id: receiptLines.id })
        .from(receiptLines)
        .where(
          and(eq(receiptLines.receiptId, receipt.id), eq(receiptLines.picklistLineId, line.id)),
        )
        .limit(1);
      if (existing)
        await db.update(receiptLines).set(lineValues).where(eq(receiptLines.id, existing.id));
      else await db.insert(receiptLines).values(lineValues);
    }
  }
}

async function ensureKanbanEvent(
  kanbanId: string,
  type: typeof kanbanEvents.$inferInsert.type,
  ref: string,
  userId: number | null,
  occurredAt: Date,
  deviceId: number | null = null,
): Promise<void> {
  const db = getDb();
  const [existing] = await db
    .select({ id: kanbanEvents.id })
    .from(kanbanEvents)
    .where(
      and(
        eq(kanbanEvents.kanbanId, kanbanId),
        eq(kanbanEvents.type, type),
        eq(kanbanEvents.ref, ref),
      ),
    )
    .limit(1);
  if (!existing)
    await db.insert(kanbanEvents).values({ kanbanId, type, ref, userId, deviceId, occurredAt });
}

function demoKanbanId(sequence: number): string {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let value = sequence;
  let encoded = '';
  do {
    encoded = alphabet[value % 32]! + encoded;
    value = Math.floor(value / 32);
  } while (value > 0);
  return `${'01JDEMARESFWKANBN'.padEnd(20, '0')}${encoded.padStart(6, '0')}`;
}

function jakartaDate(offsetDays: number): string {
  const value = new Date(Date.now() + offsetDays * 86_400_000);
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
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

/** Snapshot jadwal riil boleh diperbaiki lalu di-seed ulang tanpa menggandakan slot. */
async function syncDeliverySchedules(
  values: Array<typeof deliverySchedules.$inferInsert>,
): Promise<void> {
  const db = getDb();
  const existing = await db
    .select({ id: deliverySchedules.id, sourceKey: deliverySchedules.sourceKey })
    .from(deliverySchedules);
  const byKey = new Map(existing.map((row) => [row.sourceKey, row.id]));
  let inserted = 0;
  for (const value of values) {
    const id = byKey.get(value.sourceKey);
    if (id) {
      await db
        .update(deliverySchedules)
        .set({ ...value, isActive: true })
        .where(eq(deliverySchedules.id, id));
    } else {
      await db.insert(deliverySchedules).values(value);
      inserted += 1;
    }
  }
  console.log(`[seed]   ${values.length} jadwal receiving disinkronkan (${inserted} baru)`);
}

type SupplierSeedRow = (typeof ALL_SUPPLIERS)[number] & { plantId: number };

/**
 * Workbook supplier adalah sumber master operasional. SUPPLIER LIST lama tidak
 * memuat nomor SAP, sedangkan daftar ELECTRIC membawa kode 7D yang langsung
 * dipakai dan diaktifkan. Sinkron ulang hanya menimpa kolom milik workbook.
 */
async function syncSupplierListVendors(
  values: readonly SupplierSeedRow[],
  legacyUnitPlantId: number,
): Promise<Map<string, number>> {
  const db = getDb();
  let existing = await db.select().from(vendors);
  const withoutPlant = existing.filter((row) => row.plantId === null);
  for (const row of withoutPlant) {
    await db.update(vendors).set({ plantId: legacyUnitPlantId }).where(eq(vendors.id, row.id));
  }
  if (withoutPlant.length > 0) existing = await db.select().from(vendors);

  const bySource = new Map(
    existing.filter((row) => row.sourceKey).map((row) => [row.sourceKey!, row]),
  );
  const byPlantName = new Map(
    existing.map((row) => [`${row.plantId}\u0000${row.name.trim().toUpperCase()}`, row]),
  );
  const ids = new Map<string, number>();
  let inserted = 0;

  for (const row of values) {
    const sourceValues = {
      plantId: row.plantId,
      name: row.name,
      scheduleCode: row.scheduleCode,
      truckStation: row.truckStation,
      deliveryCycle: row.deliveryCycle,
      truckType: row.truckType,
      deliveryDays: row.deliveryDays,
      deliveryDayLabel: row.deliveryDayLabel,
      palletPerDelivery: row.palletPerDelivery,
      loadingOperator: row.loadingOperator,
      location: row.location,
      sourceKey: row.sourceKey,
    };
    const authoritativeSapNo = 'sapVendorNo' in row ? row.sapVendorNo : undefined;
    const matched =
      bySource.get(row.sourceKey) ??
      byPlantName.get(`${row.plantId}\u0000${row.name.trim().toUpperCase()}`);
    if (matched) {
      await db
        .update(vendors)
        .set({
          ...sourceValues,
          ...(authoritativeSapNo ? { sapVendorNo: authoritativeSapNo, isActive: true } : {}),
        })
        .where(eq(vendors.id, matched.id));
      ids.set(row.sourceKey, matched.id);
      continue;
    }
    const id = (
      await db
        .insert(vendors)
        .values({
          ...sourceValues,
          sapVendorNo: authoritativeSapNo ?? null,
          isActive: Boolean(authoritativeSapNo),
        })
        .$returningId()
    )[0]!.id;
    ids.set(row.sourceKey, id);
    inserted += 1;
  }
  console.log(`[seed]   ${values.length} supplier workbook disinkronkan (${inserted} baru)`);
  return ids;
}

/** Mundurkan hari pengiriman sebanyak lead day kerja untuk memperoleh hari cutoff. */
function cutoffWorkdays(deliveryDays: string, leadDays: number): string {
  const result = deliveryDays.split(',').map((value) => {
    let day = Number(value.trim());
    if (!Number.isInteger(day) || day < 1 || day > 7) {
      throw new Error(`seed: delivery day tidak valid: ${value}`);
    }
    for (let count = 0; count < leadDays; count += 1) {
      do day = day === 1 ? 7 : day - 1;
      while (day === 6 || day === 7);
    }
    return day;
  });
  return [...new Set(result)].sort((a, b) => a - b).join(',');
}

/**
 * SUPPLIER LIST: DAY adalah hari pengiriman dan template waktunya masih perlu
 * dilengkapi Admin. Workbook ELECTRIC: hari/jam shipping adalah cutoff yang
 * sudah definitif, lead day 0, dan jam delivery menjadi arrival time.
 */
async function syncSupplierCutoffTemplates(
  values: typeof ALL_SUPPLIERS,
  supplierIds: ReadonlyMap<string, number>,
): Promise<void> {
  const db = getDb();
  const existing = await db.select().from(vendorCutoffs);
  const byVendor = new Map<number, typeof existing>();
  for (const row of existing) {
    const rows = byVendor.get(row.vendorId) ?? [];
    rows.push(row);
    byVendor.set(row.vendorId, rows);
  }
  let inserted = 0;
  let scheduled = 0;
  for (const row of values) {
    const vendorId = supplierIds.get(row.sourceKey);
    if (!vendorId) throw new Error(`seed: supplier ${row.sourceKey} tidak ditemukan`);
    const cutoffs = byVendor.get(vendorId) ?? [];

    // Workbook ELECTRIC menyediakan hari cutoff, jam shipping/cutoff, dan jam
    // delivery secara eksplisit. `By Schedule` tidak diberi template 00:00
    // supaya tidak pernah dianggap jadwal otomatis sungguhan.
    if ('cutoffTime' in row) {
      if (!row.cutoffTime || !row.arrivalTime || !row.deliveryDays) continue;
      scheduled += 1;
      const sourceKey = `${row.sourceKey}:CUTOFF`;
      const matched =
        cutoffs.find((cutoff) => cutoff.sourceKey === sourceKey) ??
        cutoffs.find((cutoff) => cutoff.cutoffTime === row.cutoffTime);
      const exactValues = {
        vendorId,
        cutoffTime: row.cutoffTime,
        workdays: row.deliveryDays,
        leadDays: 0,
        arrivalTime: row.arrivalTime,
        sourceKey,
        isActive: true,
      } as const;
      if (matched) {
        await db.update(vendorCutoffs).set(exactValues).where(eq(vendorCutoffs.id, matched.id));
      } else {
        await db.insert(vendorCutoffs).values(exactValues);
        inserted += 1;
      }
      continue;
    }

    scheduled += 1;
    if (cutoffs.length > 0) {
      for (const cutoff of cutoffs) {
        await db
          .update(vendorCutoffs)
          .set({ workdays: cutoffWorkdays(row.deliveryDays, cutoff.leadDays) })
          .where(eq(vendorCutoffs.id, cutoff.id));
      }
      continue;
    }
    const leadDays = 1;
    await db.insert(vendorCutoffs).values({
      vendorId,
      cutoffTime: '00:00:00',
      workdays: cutoffWorkdays(row.deliveryDays, leadDays),
      leadDays,
      arrivalTime: '00:00:00',
      sourceKey: `${row.sourceKey}:CUTOFF`,
      isActive: false,
    });
    inserted += 1;
  }
  console.log(
    `[seed]   ${scheduled} cutoff disinkronkan (${inserted} baru; ${values.length - scheduled} supplier By Schedule)`,
  );
}

function bcryptByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

main().catch(async (err) => {
  console.error('[seed] gagal:', err);
  await closeDb();
  process.exit(1);
});
