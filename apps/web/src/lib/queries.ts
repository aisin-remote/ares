import 'server-only';
import { getDb, and, asc, count, desc, eq, inArray, isNull, lt, sql } from '@ares/db';
import {
  sapOutbox,
  users,
  picklistHeaders,
  picklistLines,
  kanbans,
  vendors,
  vendorParts,
  vendorCutoffs,
  parts,
} from '@ares/db';
import type { PicklistStatus } from '@ares/contracts';

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
  const [pengguna, outboxPending, outboxFailed] = await Promise.all([
    db.select({ value: count() }).from(users),
    db
      .select({ value: count() })
      .from(sapOutbox)
      .where(sql`${sapOutbox.status} = 'PENDING'`),
    db
      .select({ value: count() })
      .from(sapOutbox)
      .where(sql`${sapOutbox.status} = 'FAILED'`),
  ]);
  return {
    pengguna: pengguna[0]?.value ?? 0,
    outboxPending: outboxPending[0]?.value ?? 0,
    outboxFailed: outboxFailed[0]?.value ?? 0,
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
