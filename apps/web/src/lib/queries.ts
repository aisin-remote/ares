import 'server-only';
import {
  getDb,
  MASTER_TABLES,
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  or,
  like,
  sql,
  roles,
  plants,
  poLines,
  poHeaders,
} from '@ares/db';
import {
  sapOutbox,
  users,
  picklistHeaders,
  picklistLines,
  kanbans,
  receiptHeaders,
  stockMutations,
  vendors,
  vendorParts,
  vendorCutoffs,
  parts,
  holidays,
} from '@ares/db';
import type { PicklistStatus, ReceiptStatus } from '@ares/contracts';
import { getEntityDef, type MasterEntity } from '@ares/contracts';
import { nextCutoff } from '@ares/domain';

export type MasterOption = { value: number; label: string; short?: string };
type RefEntity = MasterEntity | 'roles' | 'plants' | 'poLines';

/** Baca master langsung dari DB; hanya kolom registry yang dikirim ke browser. */
export async function listMaster(
  entity: MasterEntity,
  { page, perPage, q }: { page: number; perPage: number; q?: string },
) {
  const db = getDb();
  const def = getEntityDef(entity);
  // Peta tabel memang heterogen. Pemilihan kolom tetap dibatasi registry, bukan input pengguna.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const table: any = MASTER_TABLES[entity];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const columns: Record<string, any> = { id: table.id };
  for (const field of def.fields) {
    if (field.kind !== 'password' && table[field.name]) columns[field.name] = table[field.name];
  }
  const filters = q
    ? def.searchFields.filter((name) => table[name]).map((name) => like(table[name], `%${q}%`))
    : [];
  const where = filters.length ? or(...filters) : undefined;
  const [rows, totals] = await Promise.all([
    db
      .select(columns)
      .from(table)
      .where(where)
      .orderBy(asc(table[def.defaultSort] ?? table.id))
      .limit(perPage)
      .offset((page - 1) * perPage),
    db.select({ value: count() }).from(table).where(where),
  ]);
  const total = totals[0]?.value ?? 0;
  return {
    data: rows as Array<Record<string, unknown> & { id: number }>,
    meta: { page, perPage, total, totalPages: Math.max(1, Math.ceil(total / perPage)) },
  };
}

/** Pilihan referensi untuk form dan nama ringkas pada tabel. */
export async function getMasterOptions(entity: RefEntity): Promise<MasterOption[]> {
  const db = getDb();
  if (entity === 'roles') {
    const rows = await db
      .select({ id: roles.id, name: roles.name, label: roles.label })
      .from(roles)
      .orderBy(asc(roles.name));
    return rows.map((row) => ({
      value: row.id,
      label: row.label ?? row.name,
      short: row.label ?? row.name,
    }));
  }
  if (entity === 'plants') {
    const rows = await db
      .select({ id: plants.id, code: plants.code, name: plants.name })
      .from(plants)
      .where(eq(plants.isActive, true))
      .orderBy(asc(plants.code));
    return rows.map((row) => ({
      value: row.id,
      label: `${row.code} — ${row.name}`,
      short: row.code,
    }));
  }
  if (entity === 'poLines') {
    const rows = await db
      .select({ id: poLines.id, poNo: poHeaders.sapPoNo, item: poLines.item, partNo: parts.partNo })
      .from(poLines)
      .innerJoin(poHeaders, eq(poLines.poId, poHeaders.id))
      .innerJoin(parts, eq(poLines.partId, parts.id))
      .orderBy(asc(poHeaders.sapPoNo), asc(poLines.item));
    return rows.map((row) => ({
      value: row.id,
      label: `${row.poNo}/${row.item} — ${row.partNo}`,
      short: `${row.poNo}/${row.item}`,
    }));
  }
  // Kapasitas awal 3.000 vendor part (PRD §9); opsi referensi harus mencakup semuanya.
  const { data } = await listMaster(entity, { page: 1, perPage: 10_000 });
  return data
    .filter((row) => row.isActive !== false)
    .map((row) => {
      const code = row.sapVendorNo ?? row.partNo ?? row.npk ?? row.date;
      const name = row.name;
      return {
        value: row.id,
        label: [code, name].filter(Boolean).join(' — ') || String(row.id),
        short: String(code ?? name ?? row.id),
      };
    });
}

/** Simulasi F-04/F-05 per supplier, tanpa menjalankan job cutoff. */
export async function getNextCutoffPreviews(now = new Date()) {
  const db = getDb();
  const [cutoffs, holidayRows, vendorRows] = await Promise.all([
    db
      .select({
        vendorId: vendors.id,
        vendorName: vendors.name,
        cutoffTime: vendorCutoffs.cutoffTime,
        workdays: vendorCutoffs.workdays,
        leadDays: vendorCutoffs.leadDays,
        arrivalTime: vendorCutoffs.arrivalTime,
        holidayShift: vendorCutoffs.holidayShift,
      })
      .from(vendorCutoffs)
      .innerJoin(vendors, eq(vendorCutoffs.vendorId, vendors.id))
      .where(and(eq(vendorCutoffs.isActive, true), eq(vendors.isActive, true)))
      .orderBy(asc(vendors.name), asc(vendorCutoffs.cutoffTime)),
    db.select({ date: holidays.date }).from(holidays).where(eq(holidays.isActive, true)),
    db
      .select({ id: vendors.id, name: vendors.name })
      .from(vendors)
      .where(eq(vendors.isActive, true))
      .orderBy(asc(vendors.name)),
  ]);
  const dates = holidayRows.map((row) => row.date);
  type Preview = {
    vendorName: string;
    cutoffAt: Date | null;
    deliveryDate: string | null;
    arrivalAt: Date | null;
    warning: string | null;
  };
  const byVendor = new Map<number, Preview>(
    vendorRows.map((vendor) => [
      vendor.id,
      {
        vendorName: vendor.name,
        cutoffAt: null,
        deliveryDate: null,
        arrivalAt: null,
        warning: 'Belum ada jadwal cutoff aktif',
      },
    ]),
  );
  for (const row of cutoffs) {
    let result;
    try {
      result = nextCutoff({
        now,
        cutoffTime: row.cutoffTime,
        workdays: row.workdays,
        leadDays: row.leadDays,
        arrivalTime: row.arrivalTime,
        holidayShift: row.holidayShift,
        holidays: dates,
      });
    } catch {
      const current = byVendor.get(row.vendorId);
      if (current && !current.cutoffAt) current.warning = 'Jadwal cutoff tidak valid';
      continue;
    }
    if (!result) continue;
    const current = byVendor.get(row.vendorId);
    if (!current?.cutoffAt || result.cutoffAt < current.cutoffAt)
      byVendor.set(row.vendorId, { vendorName: row.vendorName, ...result, warning: null });
  }
  return [...byVendor.values()].sort((a, b) => a.vendorName.localeCompare(b.vendorName));
}

/**
 * Query BACA untuk Server Component.
 *
 * Aturan repo: halaman membaca database langsung dari sini (tanpa hop ke API),
 * semua TULIS lewat apps/api. Tambahkan fungsi per halaman, jangan per tabel.
 *
 * ponytail: baru dashboard dan picklist; query antrean, receiving, dan stok
 * menyusul bersama skemanya (PRD bagian 7).
 */
export async function getDashboardSummary() {
  const db = getDb();
  const awalHari = new Date(`${hariIniJakarta()}T00:00:00+07:00`);
  const akhirHari = new Date(awalHari.getTime() + 24 * 60 * 60 * 1000);
  const [statusHariIni, supplierTertinggal, outboxPending, grFailed] = await Promise.all([
    db
      .select({ status: picklistHeaders.status, value: count() })
      .from(picklistHeaders)
      .where(
        and(gte(picklistHeaders.createdAt, awalHari), lt(picklistHeaders.createdAt, akhirHari)),
      )
      .groupBy(picklistHeaders.status),
    db
      .select({
        vendorId: vendors.id,
        vendorName: vendors.name,
        belumUnduh: sql<number>`sum(case when ${picklistHeaders.status} = 'ISSUED' then 1 else 0 end)`,
        belumKonfirmasi: sql<number>`sum(case when ${picklistHeaders.status} = 'DOWNLOADED' then 1 else 0 end)`,
      })
      .from(picklistHeaders)
      .innerJoin(vendors, eq(picklistHeaders.vendorId, vendors.id))
      .where(inArray(picklistHeaders.status, ['ISSUED', 'DOWNLOADED']))
      .groupBy(vendors.id, vendors.name)
      .orderBy(asc(vendors.name)),
    db
      .select({ value: count() })
      .from(sapOutbox)
      .where(sql`${sapOutbox.status} = 'PENDING'`),
    db
      .select({ value: count() })
      .from(sapOutbox)
      .where(and(eq(sapOutbox.status, 'FAILED'), eq(sapOutbox.docType, 'GR'))),
  ]);
  const picklistHariIni = Object.fromEntries(
    statusHariIni.map((row) => [row.status, Number(row.value)]),
  ) as Partial<Record<PicklistStatus, number>>;
  return {
    picklistHariIni,
    totalPicklistHariIni: statusHariIni.reduce((sum, row) => sum + Number(row.value), 0),
    supplierTertinggal: supplierTertinggal.map((row) => ({
      ...row,
      belumUnduh: Number(row.belumUnduh),
      belumKonfirmasi: Number(row.belumKonfirmasi),
    })),
    outboxPending: outboxPending[0]?.value ?? 0,
    grFailed: grFailed[0]?.value ?? 0,
  };
}

// ─── Picklist (F-17, F-20, F-21) ────────────────────────────────────────────

/**
 * Batas data pembaca: id vendor untuk akun supplier, null untuk akun internal.
 *
 * Parameter WAJIB di setiap query picklist, bukan opsional. Kalau opsional,
 * satu pemanggil yang lupa mengisinya akan menampilkan order seluruh supplier
 * tanpa satu pun galat; dengan wajib, kelalaian itu gagal saat kompilasi
 * (aturan repo 9).
 */
export type VendorScope = number | null;

const scopeVendor = (scope: VendorScope) =>
  scope === null ? undefined : eq(picklistHeaders.vendorId, scope);

/** Hitungan per status untuk kartu angka di halaman daftar dan portal. */
export async function getPicklistCounts(scope: VendorScope) {
  const db = getDb();
  const [rows, terlambatRows] = await Promise.all([
    db
      .select({ status: picklistHeaders.status, value: count() })
      .from(picklistHeaders)
      .where(scopeVendor(scope))
      .groupBy(picklistHeaders.status),
    // Terlambat konfirmasi: tanggal kirim sudah lewat tetapi supplier belum
    // menekan "konfirmasi kirim". Batas tanggalnya dihitung di sini, bukan
    // dengan CONVERT_TZ di MySQL — fungsi itu perlu tabel zona waktu dimuat di
    // server dan gagal senyap kalau tidak ada.
    db
      .select({ value: count() })
      .from(picklistHeaders)
      .where(
        and(
          scopeVendor(scope),
          isNull(picklistHeaders.shippedAt),
          lt(picklistHeaders.deliveryDate, hariIniJakarta()),
          inArray(picklistHeaders.status, ['ISSUED', 'DOWNLOADED']),
        ),
      ),
  ]);
  const per = (s: PicklistStatus) => rows.find((r) => r.status === s)?.value ?? 0;
  return {
    terbit: per('ISSUED'),
    diunduh: per('DOWNLOADED'),
    // Sedang berjalan di jalan atau baru diterima sebagian — sama-sama "belum
    // beres", jadi dijadikan satu angka.
    jalan: per('SHIPPED') + per('PARTIAL'),
    selesai: per('COMPLETE'),
    dibatalkan: per('CANCELLED'),
    terlambat: terlambatRows[0]?.value ?? 0,
  };
}

/** Tanggal hari ini pada jam pabrik, bentuk YYYY-MM-DD untuk kolom DATE. */
function hariIniJakarta(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
}

export async function listPicklists(
  scope: VendorScope,
  opts: {
    page: number;
    perPage: number;
    status?: PicklistStatus;
    /** Beberapa status sekaligus, mis. daftar order aktif di portal. */
    statuses?: PicklistStatus[];
  },
) {
  const db = getDb();
  const where = and(
    scopeVendor(scope),
    opts.status ? eq(picklistHeaders.status, opts.status) : undefined,
    opts.statuses && opts.statuses.length > 0
      ? inArray(picklistHeaders.status, opts.statuses)
      : undefined,
  );

  const [rows, totalRows] = await Promise.all([
    db
      .select({
        id: picklistHeaders.id,
        picklistNo: picklistHeaders.picklistNo,
        revision: picklistHeaders.revision,
        type: picklistHeaders.type,
        status: picklistHeaders.status,
        vendorName: vendors.name,
        deliveryDate: picklistHeaders.deliveryDate,
        arrivalTime: picklistHeaders.arrivalTime,
        cycle: picklistHeaders.cycle,
        pdfReadyAt: picklistHeaders.pdfReadyAt,
        downloadedAt: picklistHeaders.downloadedAt,
        shippedAt: picklistHeaders.shippedAt,
        createdAt: picklistHeaders.createdAt,
        lineCount: sql<number>`(select count(*) from ${picklistLines} where ${picklistLines.picklistId} = ${picklistHeaders.id})`,
        boxOrdered: sql<number>`(select coalesce(sum(${picklistLines.boxOrdered}), 0) from ${picklistLines} where ${picklistLines.picklistId} = ${picklistHeaders.id})`,
      })
      .from(picklistHeaders)
      .innerJoin(vendors, eq(picklistHeaders.vendorId, vendors.id))
      .where(where)
      .orderBy(desc(picklistHeaders.id))
      .limit(opts.perPage)
      .offset((opts.page - 1) * opts.perPage),
    db.select({ value: count() }).from(picklistHeaders).where(where),
  ]);

  const total = totalRows[0]?.value ?? 0;
  return {
    // COUNT/SUM dari subquery kembali sebagai string di MySQL; dijadikan angka
    // di sini supaya komponen tidak perlu tahu.
    data: rows.map((r) => ({
      ...r,
      lineCount: Number(r.lineCount),
      boxOrdered: Number(r.boxOrdered),
    })),
    meta: {
      page: opts.page,
      perPage: opts.perPage,
      total,
      totalPages: Math.max(1, Math.ceil(total / opts.perPage)),
    },
  };
}

/**
 * Detail satu picklist beserta line-nya. `null` bila nomornya tidak ada —
 * termasuk bila picklist itu milik supplier lain, sehingga menebak nomor tidak
 * membedakan "tidak ada" dari "bukan milikmu".
 */
export async function getPicklistDetail(scope: VendorScope, id: number) {
  const db = getDb();
  const [header] = await db
    .select({
      id: picklistHeaders.id,
      picklistNo: picklistHeaders.picklistNo,
      revision: picklistHeaders.revision,
      type: picklistHeaders.type,
      status: picklistHeaders.status,
      vendorName: vendors.name,
      sapVendorNo: vendors.sapVendorNo,
      cutoffAt: picklistHeaders.cutoffAt,
      deliveryDate: picklistHeaders.deliveryDate,
      arrivalTime: picklistHeaders.arrivalTime,
      cycle: picklistHeaders.cycle,
      pdfReadyAt: picklistHeaders.pdfReadyAt,
      downloadedAt: picklistHeaders.downloadedAt,
      shippedAt: picklistHeaders.shippedAt,
      eta: picklistHeaders.eta,
      vehicleNo: picklistHeaders.vehicleNo,
      note: picklistHeaders.note,
      createdAt: picklistHeaders.createdAt,
    })
    .from(picklistHeaders)
    .innerJoin(vendors, eq(picklistHeaders.vendorId, vendors.id))
    .where(and(eq(picklistHeaders.id, id), scopeVendor(scope)))
    .limit(1);
  if (!header) return null;

  const lines = await db
    .select({
      id: picklistLines.id,
      partNo: parts.partNo,
      partName: parts.name,
      backNo: vendorParts.backNo,
      rack: vendorParts.rack,
      boxOrdered: picklistLines.boxOrdered,
      boxShipped: picklistLines.boxShipped,
      boxReceived: picklistLines.boxReceived,
      qtyPerBox: picklistLines.qtyPerBox,
      pcs: picklistLines.pcs,
      sapPoNo: picklistLines.sapPoNo,
      sapPoItem: picklistLines.sapPoItem,
      status: picklistLines.status,
      kanbanCount: sql<number>`(select count(*) from ${kanbans} where ${kanbans.picklistLineId} = ${picklistLines.id})`,
    })
    .from(picklistLines)
    .innerJoin(vendorParts, eq(picklistLines.vendorPartId, vendorParts.id))
    .innerJoin(parts, eq(vendorParts.partId, parts.id))
    .where(eq(picklistLines.picklistId, id))
    .orderBy(asc(picklistLines.id));

  return { ...header, lines: lines.map((l) => ({ ...l, kanbanCount: Number(l.kanbanCount) })) };
}

/**
 * Opsi form order manual: supplier aktif beserta cutoff dan vendor part-nya.
 *
 * KHUSUS layar PPIC. Jangan dipakai ulang di portal: isinya seluruh supplier
 * aktif, dan daftar pesaing ikut terkirim ke browser walaupun tidak dirender.
 *
 * Digabung di sini (tiga query + gabung di memori) karena satu form memang
 * butuh ketiganya sekaligus; layar tidak perlu tahu susunan tabelnya.
 */
export async function getOrderOptions() {
  const db = getDb();
  const [vendorRows, cutoffRows, vendorPartRows] = await Promise.all([
    db
      .select({ id: vendors.id, name: vendors.name, sapVendorNo: vendors.sapVendorNo })
      .from(vendors)
      .where(eq(vendors.isActive, true))
      .orderBy(asc(vendors.name)),
    db
      .select({
        id: vendorCutoffs.id,
        vendorId: vendorCutoffs.vendorId,
        cutoffTime: vendorCutoffs.cutoffTime,
        arrivalTime: vendorCutoffs.arrivalTime,
      })
      .from(vendorCutoffs)
      .where(eq(vendorCutoffs.isActive, true))
      .orderBy(asc(vendorCutoffs.cutoffTime)),
    db
      .select({
        id: vendorParts.id,
        vendorId: vendorParts.vendorId,
        partNo: parts.partNo,
        partName: parts.name,
        backNo: vendorParts.backNo,
        qtyPerBox: vendorParts.qtyPerBox,
      })
      .from(vendorParts)
      .innerJoin(parts, eq(vendorParts.partId, parts.id))
      .where(and(eq(vendorParts.isActive, true), eq(parts.isActive, true)))
      .orderBy(asc(parts.partNo)),
  ]);

  return vendorRows.map((v) => ({
    ...v,
    cutoffs: cutoffRows.filter((c) => c.vendorId === v.id),
    parts: vendorPartRows.filter((p) => p.vendorId === v.id),
  }));
}

export type OrderOption = Awaited<ReturnType<typeof getOrderOptions>>[number];

/** Nama supplier untuk wordmark portal (PRD §10.2: `ARES · <nama vendor>`). */
export async function getVendorName(vendorId: number): Promise<string | null> {
  const db = getDb();
  const [row] = await db
    .select({ name: vendors.name })
    .from(vendors)
    .where(eq(vendors.id, vendorId))
    .limit(1);
  return row?.name ?? null;
}

// ─── Sesi scan receiving (F-34–F-37) ────────────────────────────────────────

/**
 * Nama tabel/kolom di subquery ditulis eksplisit: di dalam `sql` Drizzle
 * merender kolom luar tanpa nama tabel, dan `PICKLIST_LINE_ID = ID` diam-diam
 * membandingkan dengan ID kanban sendiri (bug yang sudah pernah kejadian di
 * API). Angka scan per sesi datang dari TM_KANBAN.RECEIPT_ID, bukan dari
 * TT_SCAN_EVENT — event menyimpan percobaan, kanban menyimpan keadaan.
 */
const boxScannedExpr = (receiptId: number) =>
  sql<number>`(select count(*) from TM_KANBAN k where k.PICKLIST_LINE_ID = TT_PICKLIST_L.ID and k.RECEIPT_ID = ${receiptId} and k.STATUS = 'RECEIVED')`;

/** Kartu angka halaman penerimaan. "Hari ini" = jam pabrik. */
export async function getReceiptCounts() {
  const db = getDb();
  const awalHari = new Date(`${hariIniJakarta()}T00:00:00+07:00`);
  const [terbuka, ditutup, box] = await Promise.all([
    db.select({ value: count() }).from(receiptHeaders).where(eq(receiptHeaders.status, 'OPEN')),
    db
      .select({ value: count() })
      .from(receiptHeaders)
      .where(and(eq(receiptHeaders.status, 'CLOSED'), gte(receiptHeaders.closedAt, awalHari))),
    db
      .select({
        value: sql<number>`coalesce(sum((select coalesce(sum(rl.BOX_RECEIVED),0) from TT_RECEIPT_L rl where rl.RECEIPT_ID = TT_RECEIPT_H.ID)),0)`,
      })
      .from(receiptHeaders)
      .where(and(eq(receiptHeaders.status, 'CLOSED'), gte(receiptHeaders.closedAt, awalHari))),
  ]);
  return {
    terbuka: terbuka[0]?.value ?? 0,
    ditutupHariIni: ditutup[0]?.value ?? 0,
    boxHariIni: Number(box[0]?.value ?? 0),
  };
}

export async function listReceipts(opts: {
  page: number;
  perPage: number;
  status?: ReceiptStatus;
}) {
  const db = getDb();
  const where = opts.status ? eq(receiptHeaders.status, opts.status) : undefined;
  const [rows, totalRows] = await Promise.all([
    db
      .select({
        id: receiptHeaders.id,
        receiptNo: receiptHeaders.receiptNo,
        status: receiptHeaders.status,
        openedAt: receiptHeaders.createdAt,
        closedAt: receiptHeaders.closedAt,
        picklistId: picklistHeaders.id,
        picklistNo: picklistHeaders.picklistNo,
        revision: picklistHeaders.revision,
        picklistStatus: picklistHeaders.status,
        vendorName: vendors.name,
        grStatus: sql<
          string | null
        >`(select so.STATUS from TT_SAP_OUTBOX so where so.SOURCE_TABLE = 'TT_RECEIPT_H' and so.SOURCE_ID = TT_RECEIPT_H.ID and so.DOC_TYPE = 'GR' limit 1)`,
        boxOrdered: sql<number>`(select coalesce(sum(l.BOX_ORDERED),0) from TT_PICKLIST_L l where l.PICKLIST_ID = TT_PICKLIST_H.ID)`,
        boxScanned: sql<number>`(select count(*) from TM_KANBAN k where k.RECEIPT_ID = TT_RECEIPT_H.ID and k.STATUS = 'RECEIVED')`,
      })
      .from(receiptHeaders)
      .innerJoin(picklistHeaders, eq(receiptHeaders.picklistId, picklistHeaders.id))
      .innerJoin(vendors, eq(picklistHeaders.vendorId, vendors.id))
      .where(where)
      .orderBy(desc(receiptHeaders.id))
      .limit(opts.perPage)
      .offset((opts.page - 1) * opts.perPage),
    db.select({ value: count() }).from(receiptHeaders).where(where),
  ]);
  const total = totalRows[0]?.value ?? 0;
  return {
    data: rows.map((r) => ({
      ...r,
      boxOrdered: Number(r.boxOrdered),
      boxScanned: Number(r.boxScanned),
    })),
    meta: {
      page: opts.page,
      perPage: opts.perPage,
      total,
      totalPages: Math.max(1, Math.ceil(total / opts.perPage)),
    },
  };
}

/**
 * Satu sesi scan beserta progres per line — dipakai layar stasiun (OPEN) dan
 * halaman ringkasan (CLOSED). Bentuk line-nya sama dengan balasan
 * POST /receipts/:id/scan, jadi layar stasiun bisa menimpa baris dari respons
 * tiap scan tanpa memuat ulang.
 */
export async function getReceiptDetail(id: number) {
  const db = getDb();
  const [r] = await db
    .select({
      id: receiptHeaders.id,
      receiptNo: receiptHeaders.receiptNo,
      status: receiptHeaders.status,
      openedAt: receiptHeaders.createdAt,
      closedAt: receiptHeaders.closedAt,
      note: receiptHeaders.note,
      closedBy: users.name,
      picklistId: picklistHeaders.id,
      picklistNo: picklistHeaders.picklistNo,
      revision: picklistHeaders.revision,
      picklistStatus: picklistHeaders.status,
      vendorName: vendors.name,
      deliveryDate: picklistHeaders.deliveryDate,
      arrivalTime: picklistHeaders.arrivalTime,
      cycle: picklistHeaders.cycle,
    })
    .from(receiptHeaders)
    .innerJoin(picklistHeaders, eq(receiptHeaders.picklistId, picklistHeaders.id))
    .innerJoin(vendors, eq(picklistHeaders.vendorId, vendors.id))
    .leftJoin(users, eq(receiptHeaders.userId, users.id))
    .where(eq(receiptHeaders.id, id))
    .limit(1);
  if (!r) return null;

  const [lines, outboxRows] = await Promise.all([
    db
      .select({
        id: picklistLines.id,
        partNo: parts.partNo,
        partName: parts.name,
        backNo: vendorParts.backNo,
        boxOrdered: picklistLines.boxOrdered,
        boxShipped: picklistLines.boxShipped,
        boxReceived: picklistLines.boxReceived,
        status: picklistLines.status,
        boxScanned: boxScannedExpr(id),
        boxMissing: sql<number>`(select count(*) from TM_KANBAN k where k.PICKLIST_LINE_ID = TT_PICKLIST_L.ID and k.STATUS = 'MISSING')`,
        pcsReceived: sql<number>`(select coalesce(sum(rl.PCS_RECEIVED),0) from TT_RECEIPT_L rl where rl.PICKLIST_LINE_ID = TT_PICKLIST_L.ID and rl.RECEIPT_ID = ${id})`,
      })
      .from(picklistLines)
      .innerJoin(vendorParts, eq(picklistLines.vendorPartId, vendorParts.id))
      .innerJoin(parts, eq(vendorParts.partId, parts.id))
      .where(eq(picklistLines.picklistId, r.picklistId))
      .orderBy(asc(picklistLines.id)),
    // GR ke SAP untuk sesi ini (6.5.3); kosong = worker belum memungutnya.
    db
      .select({
        status: sapOutbox.status,
        sapDocNumber: sapOutbox.sapDocNumber,
        lastError: sapOutbox.lastError,
      })
      .from(sapOutbox)
      .where(
        and(
          eq(sapOutbox.sourceTable, 'TT_RECEIPT_H'),
          eq(sapOutbox.sourceId, id),
          eq(sapOutbox.docType, 'GR'),
        ),
      )
      .limit(1),
  ]);

  return {
    ...r,
    lines: lines.map((l) => ({
      ...l,
      boxScanned: Number(l.boxScanned),
      boxMissing: Number(l.boxMissing),
      pcsReceived: Number(l.pcsReceived),
    })),
    outbox: outboxRows[0] ?? null,
  };
}

export type ReceiptDetail = NonNullable<Awaited<ReturnType<typeof getReceiptDetail>>>;

// ─── Stok WH (F-41) ─────────────────────────────────────────────────────────

/**
 * Saldo per part = SUM(DELTA_PCS) TT_STOCK_MUTATION (aturan repo 7); tidak ada
 * kolom saldo. Ekuivalen box memakai QTY_PER_BOX vendor part aktif — bila satu
 * part dipasok beberapa supplier dengan kemasan berbeda, dipakai yang terkecil
 * dan supplier lainnya tetap disebut.
 */
export async function listStock(opts: { vendorId?: number; q?: string }) {
  const db = getDb();
  const rows = await db
    .select({
      partId: parts.id,
      partNo: parts.partNo,
      partName: parts.name,
      uom: parts.uom,
      pcs: sql<number>`coalesce(sum(${stockMutations.deltaPcs}), 0)`,
      mutations: count(),
      lastAt: sql<Date | null>`max(${stockMutations.occurredAt})`,
      qtyPerBox: sql<
        number | null
      >`(select min(vp.QTY_PER_BOX) from TM_VENDOR_PARTS vp where vp.PART_ID = TM_PARTS.ID and vp.IS_ACTIVE = 1)`,
      vendors: sql<
        string | null
      >`(select group_concat(distinct v.NAME order by v.NAME separator ', ') from TM_VENDOR_PARTS vp join TM_VENDOR v on v.ID = vp.VENDOR_ID where vp.PART_ID = TM_PARTS.ID and vp.IS_ACTIVE = 1)`,
    })
    .from(stockMutations)
    .innerJoin(parts, eq(stockMutations.partId, parts.id))
    .where(
      and(
        opts.vendorId
          ? sql`exists (select 1 from TM_VENDOR_PARTS vp where vp.PART_ID = TM_PARTS.ID and vp.VENDOR_ID = ${opts.vendorId})`
          : undefined,
        opts.q ? or(like(parts.partNo, `%${opts.q}%`), like(parts.name, `%${opts.q}%`)) : undefined,
      ),
    )
    .groupBy(parts.id, parts.partNo, parts.name, parts.uom)
    .orderBy(asc(parts.partNo));
  return rows.map((r) => {
    const pcs = Number(r.pcs);
    const qtyPerBox = r.qtyPerBox === null ? null : Number(r.qtyPerBox);
    return {
      ...r,
      pcs,
      mutations: Number(r.mutations),
      qtyPerBox,
      // Ekuivalen box: pembagian biasa, satu desimal cukup untuk dibaca PPIC.
      boxes: qtyPerBox ? Math.round((pcs / qtyPerBox) * 10) / 10 : null,
    };
  });
}

/** Buku mutasi satu part, terbaru dulu — rujukan dokumen ikut dibawa. */
export async function getStockLedger(partId: number, limit = 100) {
  const db = getDb();
  const [part] = await db
    .select({ id: parts.id, partNo: parts.partNo, name: parts.name, uom: parts.uom })
    .from(parts)
    .where(eq(parts.id, partId))
    .limit(1);
  if (!part) return null;

  const [rows, saldoRows, vpRows] = await Promise.all([
    db
      .select({
        id: stockMutations.id,
        sloc: stockMutations.sloc,
        deltaPcs: stockMutations.deltaPcs,
        type: stockMutations.type,
        refTable: stockMutations.refTable,
        refId: stockMutations.refId,
        note: stockMutations.note,
        userName: users.name,
        occurredAt: stockMutations.occurredAt,
        // Receipt asal untuk mutasi RECEIPT: TT_RECEIPT_L → TT_RECEIPT_H.
        receiptId: sql<
          number | null
        >`(select rl.RECEIPT_ID from TT_RECEIPT_L rl where rl.ID = TT_STOCK_MUTATION.REF_ID and TT_STOCK_MUTATION.REF_TABLE = 'TT_RECEIPT_L')`,
        receiptNo: sql<
          string | null
        >`(select rh.RECEIPT_NO from TT_RECEIPT_L rl join TT_RECEIPT_H rh on rh.ID = rl.RECEIPT_ID where rl.ID = TT_STOCK_MUTATION.REF_ID and TT_STOCK_MUTATION.REF_TABLE = 'TT_RECEIPT_L')`,
      })
      .from(stockMutations)
      .leftJoin(users, eq(stockMutations.userId, users.id))
      .where(eq(stockMutations.partId, partId))
      .orderBy(desc(stockMutations.occurredAt), desc(stockMutations.id))
      .limit(limit),
    db
      .select({ pcs: sql<number>`coalesce(sum(${stockMutations.deltaPcs}), 0)` })
      .from(stockMutations)
      .where(eq(stockMutations.partId, partId)),
    db
      .select({
        vendorName: vendors.name,
        qtyPerBox: vendorParts.qtyPerBox,
        backNo: vendorParts.backNo,
      })
      .from(vendorParts)
      .innerJoin(vendors, eq(vendorParts.vendorId, vendors.id))
      .where(and(eq(vendorParts.partId, partId), eq(vendorParts.isActive, true)))
      .orderBy(asc(vendors.name)),
  ]);

  const pcs = Number(saldoRows[0]?.pcs ?? 0);
  const qtyPerBox = vpRows.length ? Math.min(...vpRows.map((v) => v.qtyPerBox)) : null;
  return {
    part,
    pcs,
    qtyPerBox,
    boxes: qtyPerBox ? Math.round((pcs / qtyPerBox) * 10) / 10 : null,
    vendorParts: vpRows,
    mutations: rows.map((r) => ({
      ...r,
      receiptId: r.receiptId === null ? null : Number(r.receiptId),
    })),
  };
}
