import 'server-only';
import {
  getReadDb,
  MASTER_TABLES,
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  isNotNull,
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
  stockSnapshots,
  vendors,
  vendorParts,
  vendorCutoffs,
  parts,
  holidays,
  consumptions,
  mesFailures,
  orderQueues,
  deliverySchedules,
} from '@ares/db';
import type { PicklistStatus, ReceiptStatus } from '@ares/contracts';
import { getEntityDef, type MasterEntity } from '@ares/contracts';
import { nextCutoff, orderSheetDisplayNo } from '@ares/domain';
import type { GlobalSearchResult, NavNotification } from './shell-types';

const getDb = getReadDb;

export type MasterOption = { value: number; label: string; short?: string; inactive?: true };
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
export async function getMasterOptions(
  entity: RefEntity,
  includeInactive = false,
): Promise<MasterOption[]> {
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
  // Kapasitas awal 3.000 vendor part (PRD §9); opsi referensi harus mencakup
  // semuanya, jadi hanya kolom yang benar-benar dipakai label yang dibaca —
  // bukan seluruh kolom registry seperti pada daftar master.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const table: any = MASTER_TABLES[entity];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const columns: Record<string, any> = { id: table.id };
  for (const name of ['sapVendorNo', 'partNo', 'npk', 'date', 'name', 'isActive']) {
    if (table[name]) columns[name] = table[name];
  }
  const sort = getEntityDef(entity).defaultSort;
  const all = (await db
    .select(columns)
    .from(table)
    .orderBy(asc(table[sort] ?? table.id))) as Array<Record<string, unknown> & { id: number }>;
  const rows = includeInactive ? all : all.filter((row) => row.isActive !== false);
  return rows.map((row) => {
    const code = row.sapVendorNo ?? row.partNo ?? row.npk ?? row.date;
    const name = row.name;
    return {
      value: row.id,
      label: [code, name].filter(Boolean).join(' — ') || String(row.id),
      short: String(code ?? name ?? row.id),
      ...(row.isActive === false ? { inactive: true as const } : {}),
    };
  });
}

/** Simulasi F-04/F-05 per supplier, tanpa menjalankan job cutoff. */
export async function getNextCutoffPreviews(now = new Date(), plantId?: number) {
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
      .where(
        and(
          eq(vendorCutoffs.isActive, true),
          eq(vendors.isActive, true),
          plantId ? eq(vendors.plantId, plantId) : undefined,
        ),
      )
      .orderBy(asc(vendors.name), asc(vendorCutoffs.cutoffTime)),
    db.select({ date: holidays.date }).from(holidays).where(eq(holidays.isActive, true)),
    db
      .select({ id: vendors.id, name: vendors.name })
      .from(vendors)
      .where(and(eq(vendors.isActive, true), plantId ? eq(vendors.plantId, plantId) : undefined))
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
export async function getDashboardSummary(schedule?: {
  startDate: string;
  endDate: string;
  plantId?: number;
  /** Filter Gantt; diabaikan → ikut plantId; `null` = semua plant. */
  deliveryPlantId?: number | null;
}) {
  const db = getDb();
  const deliveryPlantId =
    schedule?.deliveryPlantId === undefined
      ? schedule?.plantId
      : (schedule.deliveryPlantId ?? undefined);
  const awalHari = new Date(`${hariIniJakarta()}T00:00:00+07:00`);
  const akhirHari = new Date(awalHari.getTime() + 24 * 60 * 60 * 1000);
  const awalJadwal = new Date(`${schedule?.startDate ?? hariIniJakarta()}T00:00:00+07:00`);
  const akhirJadwal = new Date(`${schedule?.endDate ?? hariIniJakarta()}T00:00:00+07:00`);
  const akhirJadwalEksklusif = new Date(akhirJadwal.getTime() + 86_400_000);
  const [
    statusHariIni,
    supplierTertinggal,
    outboxPending,
    grFailed,
    blockedQueues,
    deliverySchedule,
    recurringSchedule,
  ] = await Promise.all([
    db
      .select({ status: picklistHeaders.status, value: count() })
      .from(picklistHeaders)
      .where(
        and(
          gte(picklistHeaders.createdAt, awalHari),
          lt(picklistHeaders.createdAt, akhirHari),
          schedule?.plantId ? eq(picklistHeaders.plantId, schedule.plantId) : undefined,
        ),
      )
      .groupBy(picklistHeaders.status),
    db
      .select({
        vendorId: vendors.id,
        vendorName: vendors.name,
        belumUnduh: sql<number>`sum(case when ${picklistHeaders.downloadReminderAt} is not null then 1 else 0 end)`,
        belumKonfirmasi: sql<number>`sum(case when ${picklistHeaders.confirmReminderAt} is not null then 1 else 0 end)`,
      })
      .from(picklistHeaders)
      .innerJoin(vendors, eq(picklistHeaders.vendorId, vendors.id))
      .where(
        and(
          inArray(picklistHeaders.status, ['ISSUED', 'DOWNLOADED']),
          or(
            isNotNull(picklistHeaders.downloadReminderAt),
            isNotNull(picklistHeaders.confirmReminderAt),
          ),
          schedule?.plantId ? eq(picklistHeaders.plantId, schedule.plantId) : undefined,
        ),
      )
      .groupBy(vendors.id, vendors.name)
      .orderBy(asc(vendors.name)),
    db
      .select({ value: count() })
      .from(sapOutbox)
      .where(
        and(
          sql`${sapOutbox.status} = 'PENDING'`,
          schedule?.plantId ? eq(sapOutbox.plantId, schedule.plantId) : undefined,
        ),
      ),
    db
      .select({ value: count() })
      .from(sapOutbox)
      .where(
        and(
          eq(sapOutbox.status, 'FAILED'),
          eq(sapOutbox.docType, 'GR'),
          schedule?.plantId ? eq(sapOutbox.plantId, schedule.plantId) : undefined,
        ),
      ),
    db
      .select({
        id: orderQueues.id,
        vendorName: vendors.name,
        partNo: parts.partNo,
        pcs: orderQueues.pcs,
        cutoffAt: orderQueues.cutoffAt,
        reason: orderQueues.blockedReason,
      })
      .from(orderQueues)
      .innerJoin(vendorParts, eq(orderQueues.vendorPartId, vendorParts.id))
      .innerJoin(vendors, eq(vendorParts.vendorId, vendors.id))
      .innerJoin(parts, eq(vendorParts.partId, parts.id))
      .where(
        and(
          eq(orderQueues.status, 'OPEN'),
          like(orderQueues.blockedReason, 'PO_OPEN_QTY%'),
          schedule?.plantId ? eq(vendors.plantId, schedule.plantId) : undefined,
        ),
      )
      .orderBy(asc(orderQueues.cutoffAt), asc(vendors.name)),
    db
      .select({
        id: picklistHeaders.publicId,
        picklistNo: picklistHeaders.picklistNo,
        revision: picklistHeaders.revision,
        vendorId: vendors.id,
        vendorName: vendors.name,
        status: picklistHeaders.status,
        cutoffAt: picklistHeaders.cutoffAt,
        deliveryDate: picklistHeaders.deliveryDate,
        arrivalTime: picklistHeaders.arrivalTime,
        boxOrdered: sql<number>`(select coalesce(sum(${picklistLines.boxOrdered}), 0) from ${picklistLines} where ${picklistLines.picklistId} = ${picklistHeaders.id})`,
      })
      .from(picklistHeaders)
      .innerJoin(vendors, eq(picklistHeaders.vendorId, vendors.id))
      .where(
        and(
          inArray(picklistHeaders.status, [
            'ISSUED',
            'DOWNLOADED',
            'SHIPPED',
            'PARTIAL',
            'COMPLETE',
          ]),
          deliveryPlantId ? eq(picklistHeaders.plantId, deliveryPlantId) : undefined,
          gte(picklistHeaders.deliveryDate, schedule?.startDate ?? hariIniJakarta()),
          lt(
            picklistHeaders.deliveryDate,
            addCalendarDays(schedule?.endDate ?? hariIniJakarta(), 1),
          ),
        ),
      )
      .orderBy(
        asc(vendors.name),
        asc(picklistHeaders.deliveryDate),
        asc(picklistHeaders.arrivalTime),
      ),
    db
      .select({
        id: deliverySchedules.id,
        supplierLabel: deliverySchedules.supplierLabel,
        truckStation: deliverySchedules.truckStation,
        dayOfWeek: deliverySchedules.dayOfWeek,
        arrivalTime: deliverySchedules.arrivalTime,
        durationMinutes: deliverySchedules.durationMinutes,
      })
      .from(deliverySchedules)
      .where(
        and(
          eq(deliverySchedules.isActive, true),
          deliveryPlantId ? eq(deliverySchedules.plantId, deliveryPlantId) : undefined,
        ),
      )
      .orderBy(asc(deliverySchedules.dayOfWeek), asc(deliverySchedules.arrivalTime)),
  ]);
  const recurringInstances = expandRecurringSchedules(
    recurringSchedule,
    schedule?.startDate ?? hariIniJakarta(),
    schedule?.endDate ?? hariIniJakarta(),
  );
  const actualInstances = deliverySchedule.map((row) => {
    const arrivalAt = new Date(`${row.deliveryDate}T${String(row.arrivalTime).slice(0, 8)}+07:00`);
    return {
      key: `actual:${row.id}`,
      kind: 'ACTUAL' as const,
      id: row.id,
      picklistNo: row.picklistNo,
      revision: row.revision,
      vendorName: row.vendorName,
      status: row.status,
      arrivalAt,
      endAt: new Date(arrivalAt.getTime() + 120 * 60_000),
      boxOrdered: Number(row.boxOrdered),
      truckStation: null,
    };
  });
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
    blockedQueues,
    deliverySchedule: [...recurringInstances, ...actualInstances].sort(
      (a, b) =>
        a.vendorName.localeCompare(b.vendorName) || a.arrivalAt.getTime() - b.arrivalAt.getTime(),
    ),
    deliveryWindow: { start: awalJadwal, end: akhirJadwalEksklusif },
  };
}

function expandRecurringSchedules(
  rows: Array<{
    id: number;
    supplierLabel: string;
    truckStation: string;
    dayOfWeek: number;
    arrivalTime: string;
    durationMinutes: number;
  }>,
  startDate: string,
  endDate: string,
) {
  const result: Array<{
    key: string;
    kind: 'PLANNED';
    id: number;
    picklistNo: null;
    revision: number;
    vendorName: string;
    status: null;
    arrivalAt: Date;
    endAt: Date;
    boxOrdered: null;
    truckStation: string;
  }> = [];
  for (let date = startDate; date <= endDate; date = addCalendarDays(date, 1)) {
    const jsDay = new Date(`${date}T12:00:00Z`).getUTCDay();
    const isoDay = jsDay === 0 ? 7 : jsDay;
    for (const row of rows) {
      if (row.dayOfWeek !== isoDay) continue;
      const arrivalAt = new Date(`${date}T${String(row.arrivalTime).slice(0, 8)}+07:00`);
      result.push({
        key: `planned:${row.id}:${date}`,
        kind: 'PLANNED',
        id: row.id,
        picklistNo: null,
        revision: 0,
        vendorName: row.supplierLabel,
        status: null,
        arrivalAt,
        endAt: new Date(arrivalAt.getTime() + row.durationMinutes * 60_000),
        boxOrdered: null,
        truckStation: row.truckStation,
      });
    }
  }
  return result;
}

/** Rentang awal jadwal receiving: Senin sampai Minggu pada minggu berjalan. */
export function getDeliveryDateRange(params: { start_date?: string; end_date?: string }) {
  const today = hariIniJakarta();
  const date = new Date(`${today}T12:00:00Z`);
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - mondayOffset);
  const defaultStart = date.toISOString().slice(0, 10);
  date.setUTCDate(date.getUTCDate() + 6);
  const defaultEnd = date.toISOString().slice(0, 10);
  const valid = (value: string | undefined) => /^\d{4}-\d{2}-\d{2}$/.test(value ?? '');
  const requestedStart = valid(params.start_date) ? params.start_date! : defaultStart;
  const requestedEnd = valid(params.end_date) ? params.end_date! : defaultEnd;
  return requestedStart <= requestedEnd
    ? { startDate: requestedStart, endDate: requestedEnd }
    : { startDate: defaultStart, endDate: defaultEnd };
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

/** UUID baru untuk URL; angka lama tetap diterima selama masa transisi bookmark. */
const picklistReference = (reference: string) => {
  const legacyId = /^\d+$/.test(reference) ? Number(reference) : null;
  return legacyId && Number.isSafeInteger(legacyId)
    ? or(eq(picklistHeaders.publicId, reference), eq(picklistHeaders.id, legacyId))
    : eq(picklistHeaders.publicId, reference);
};

const receiptReference = (reference: string) => {
  const legacyId = /^\d+$/.test(reference) ? Number(reference) : null;
  return legacyId && Number.isSafeInteger(legacyId)
    ? or(eq(receiptHeaders.publicId, reference), eq(receiptHeaders.id, legacyId))
    : eq(receiptHeaders.publicId, reference);
};

/** Data lintas modul untuk command palette; seluruh hasil tetap mengikuti scope sesi. */
export async function searchGlobalData(opts: {
  q: string;
  plantId: number;
  vendorId: number | null;
  permissions: string[];
}): Promise<GlobalSearchResult[]> {
  const db = getDb();
  const permissions = new Set(opts.permissions);
  const escaped = opts.q.replace(/[\\%_]/g, '\\$&');
  const pattern = `%${escaped}%`;
  const kanbanQuery = opts.q.replace(/^ARES:K:/i, '').trim();
  const kanbanPattern = `%${kanbanQuery.replace(/[\\%_]/g, '\\$&')}%`;
  const orderHref = (id: string) => (opts.vendorId == null ? `/picklist/${id}` : `/portal/${id}`);
  const orderScope = and(
    eq(picklistHeaders.plantId, opts.plantId),
    opts.vendorId == null ? undefined : eq(picklistHeaders.vendorId, opts.vendorId),
  );

  const [orders, receipts, cards, partRows, vendorRows] = await Promise.all([
    permissions.has('picklist.read')
      ? db
          .select({
            publicId: picklistHeaders.publicId,
            picklistNo: picklistHeaders.picklistNo,
            revision: picklistHeaders.revision,
            status: picklistHeaders.status,
            vendorName: vendors.name,
            deliveryDate: picklistHeaders.deliveryDate,
          })
          .from(picklistHeaders)
          .innerJoin(vendors, eq(picklistHeaders.vendorId, vendors.id))
          .where(
            and(
              orderScope,
              or(like(picklistHeaders.picklistNo, pattern), like(vendors.name, pattern)),
            ),
          )
          .orderBy(desc(picklistHeaders.id))
          .limit(6)
      : Promise.resolve([]),
    opts.vendorId == null && permissions.has('receipt.read')
      ? db
          .select({
            publicId: receiptHeaders.publicId,
            receiptNo: receiptHeaders.receiptNo,
            status: receiptHeaders.status,
            picklistNo: picklistHeaders.picklistNo,
            vendorName: vendors.name,
          })
          .from(receiptHeaders)
          .innerJoin(picklistHeaders, eq(receiptHeaders.picklistId, picklistHeaders.id))
          .innerJoin(vendors, eq(picklistHeaders.vendorId, vendors.id))
          .where(
            and(
              eq(receiptHeaders.plantId, opts.plantId),
              or(
                like(receiptHeaders.receiptNo, pattern),
                like(picklistHeaders.picklistNo, pattern),
                like(vendors.name, pattern),
              ),
            ),
          )
          .orderBy(desc(receiptHeaders.id))
          .limit(5)
      : Promise.resolve([]),
    permissions.has('picklist.read') && kanbanQuery.length >= 2
      ? db
          .select({
            id: kanbans.id,
            serial: kanbans.serial,
            picklistPublicId: picklistHeaders.publicId,
            picklistNo: picklistHeaders.picklistNo,
            vendorName: vendors.name,
          })
          .from(kanbans)
          .innerJoin(picklistLines, eq(kanbans.picklistLineId, picklistLines.id))
          .innerJoin(picklistHeaders, eq(picklistLines.picklistId, picklistHeaders.id))
          .innerJoin(vendors, eq(picklistHeaders.vendorId, vendors.id))
          .where(and(orderScope, like(kanbans.id, kanbanPattern)))
          .orderBy(desc(kanbans.createdAt))
          .limit(5)
      : Promise.resolve([]),
    opts.vendorId == null && (permissions.has('stock.read') || permissions.has('master.read'))
      ? db
          .select({
            id: parts.id,
            partNo: parts.partNo,
            name: parts.name,
            sapMaterialNo: parts.sapMaterialNo,
          })
          .from(parts)
          .where(
            or(
              like(parts.partNo, pattern),
              like(parts.name, pattern),
              like(parts.sapMaterialNo, pattern),
            ),
          )
          .orderBy(asc(parts.partNo))
          .limit(6)
      : Promise.resolve([]),
    opts.vendorId == null && permissions.has('master.read')
      ? db
          .select({
            name: vendors.name,
            sapVendorNo: vendors.sapVendorNo,
            scheduleCode: vendors.scheduleCode,
          })
          .from(vendors)
          .where(
            or(
              like(vendors.name, pattern),
              like(vendors.sapVendorNo, pattern),
              like(vendors.scheduleCode, pattern),
            ),
          )
          .orderBy(asc(vendors.name))
          .limit(5)
      : Promise.resolve([]),
  ]);

  return [
    ...orders.map(
      (row): GlobalSearchResult => ({
        type: 'Order Sheet',
        title: orderSheetDisplayNo(row.picklistNo, row.revision),
        subtitle: `${row.vendorName} · kirim ${row.deliveryDate} · ${row.status}`,
        href: orderHref(row.publicId),
        icon: 'ClipboardList',
      }),
    ),
    ...receipts.map(
      (row): GlobalSearchResult => ({
        type: 'Receipt',
        title: row.receiptNo,
        subtitle: `${row.picklistNo} · ${row.vendorName} · ${row.status}`,
        href: `/receiving/${row.publicId}/ringkasan`,
        icon: 'Truck',
      }),
    ),
    ...cards.map(
      (row): GlobalSearchResult => ({
        type: 'Kanban',
        title: row.id,
        subtitle: `${row.picklistNo} · ${row.vendorName} · serial ${row.serial}`,
        href: orderHref(row.picklistPublicId),
        icon: 'ScanLine',
      }),
    ),
    ...partRows.map(
      (row): GlobalSearchResult => ({
        type: 'Part',
        title: row.partNo,
        subtitle: `${row.name} · SAP ${row.sapMaterialNo}`,
        href: permissions.has('stock.read')
          ? `/stock/${row.id}`
          : `/master/parts?q=${encodeURIComponent(row.partNo)}`,
        icon: 'Package',
      }),
    ),
    ...vendorRows.map(
      (row): GlobalSearchResult => ({
        type: 'Supplier',
        title: row.name,
        subtitle: [row.sapVendorNo && `SAP ${row.sapVendorNo}`, row.scheduleCode]
          .filter(Boolean)
          .join(' · '),
        href: `/master/vendors?q=${encodeURIComponent(row.name)}`,
        icon: 'Building2',
      }),
    ),
  ].slice(0, 18);
}

/** Ringkasan tindakan operasional untuk tombol notifikasi di topbar. */
export async function getNavNotifications(opts: {
  plantId: number;
  vendorId: number | null;
  permissions: string[];
}): Promise<NavNotification[]> {
  const db = getDb();
  const permissions = new Set(opts.permissions);
  const orderScope = and(
    eq(picklistHeaders.plantId, opts.plantId),
    opts.vendorId == null ? undefined : eq(picklistHeaders.vendorId, opts.vendorId),
  );
  const zero = Promise.resolve([{ value: 0 }]);
  const [issued, downloaded, failedSap, blockedQueue] = await Promise.all([
    permissions.has('picklist.read')
      ? db
          .select({ value: count() })
          .from(picklistHeaders)
          .where(and(orderScope, eq(picklistHeaders.status, 'ISSUED')))
      : zero,
    permissions.has('picklist.read')
      ? db
          .select({ value: count() })
          .from(picklistHeaders)
          .where(and(orderScope, eq(picklistHeaders.status, 'DOWNLOADED')))
      : zero,
    opts.vendorId == null && permissions.has('outbox.read')
      ? db
          .select({ value: count() })
          .from(sapOutbox)
          .where(and(eq(sapOutbox.plantId, opts.plantId), eq(sapOutbox.status, 'FAILED')))
      : zero,
    opts.vendorId == null && permissions.has('queue.write')
      ? db
          .select({ value: count() })
          .from(orderQueues)
          .where(and(eq(orderQueues.status, 'OPEN'), isNotNull(orderQueues.blockedReason)))
      : zero,
  ]);

  const portal = opts.vendorId != null;
  const items: NavNotification[] = [
    {
      id: 'order-not-downloaded',
      title: 'Order Sheet belum diunduh',
      detail: portal
        ? 'Order baru menunggu diunduh dan dicetak.'
        : 'Supplier belum mengunduh dokumen order.',
      href: portal ? '/portal' : '/picklist?status=ISSUED',
      tone: 'warn',
      count: Number(issued[0]?.value ?? 0),
    },
    {
      id: 'shipment-not-confirmed',
      title: 'Pengiriman belum dikonfirmasi',
      detail: portal
        ? 'Order sudah diunduh tetapi belum dikonfirmasi kirim.'
        : 'Supplier sudah mengunduh tetapi belum konfirmasi kirim.',
      href: portal ? '/portal' : '/picklist?status=DOWNLOADED',
      tone: 'warn',
      count: Number(downloaded[0]?.value ?? 0),
    },
    {
      id: 'sap-failed',
      title: 'Dokumen SAP gagal',
      detail: 'Periksa pesan galat lalu jalankan retry.',
      href: '/sap?status=FAILED',
      tone: 'danger',
      count: Number(failedSap[0]?.value ?? 0),
    },
    {
      id: 'queue-blocked',
      title: 'Antrean order terblokir',
      detail: 'Antrean perlu diperiksa sebelum Order Sheet dapat diterbitkan.',
      href: '/queue',
      tone: 'danger',
      count: Number(blockedQueue[0]?.value ?? 0),
    },
  ];
  return items.filter((item) => item.count > 0);
}

/** Hitungan per status untuk kartu angka di halaman daftar dan portal. */
export async function getPicklistCounts(scope: VendorScope, plantId: number) {
  const db = getDb();
  const [rows, terlambatRows] = await Promise.all([
    db
      .select({ status: picklistHeaders.status, value: count() })
      .from(picklistHeaders)
      .where(and(scopeVendor(scope), eq(picklistHeaders.plantId, plantId)))
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
          eq(picklistHeaders.plantId, plantId),
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

/** Tambah hari kalender pada nilai DATE tanpa dipengaruhi zona waktu mesin. */
function addCalendarDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export async function listPicklists(
  scope: VendorScope,
  opts: {
    page: number;
    perPage: number;
    plantId: number;
    status?: PicklistStatus;
    /** Beberapa status sekaligus, mis. daftar order aktif di portal. */
    statuses?: PicklistStatus[];
  },
) {
  const db = getDb();
  const where = and(
    scopeVendor(scope),
    eq(picklistHeaders.plantId, opts.plantId),
    opts.status ? eq(picklistHeaders.status, opts.status) : undefined,
    opts.statuses && opts.statuses.length > 0
      ? inArray(picklistHeaders.status, opts.statuses)
      : undefined,
  );

  const [rows, totalRows] = await Promise.all([
    db
      .select({
        id: picklistHeaders.id,
        publicId: picklistHeaders.publicId,
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
export async function getPicklistDetail(scope: VendorScope, reference: string, plantId: number) {
  const db = getDb();
  const [header] = await db
    .select({
      id: picklistHeaders.id,
      publicId: picklistHeaders.publicId,
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
      receiptCount: sql<number>`(select count(*) from ${receiptHeaders} where ${receiptHeaders.picklistId} = ${picklistHeaders.id})`,
    })
    .from(picklistHeaders)
    .innerJoin(vendors, eq(picklistHeaders.vendorId, vendors.id))
    .where(
      and(picklistReference(reference), eq(picklistHeaders.plantId, plantId), scopeVendor(scope)),
    )
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
    .where(eq(picklistLines.picklistId, header.id))
    .orderBy(asc(picklistLines.id));

  return {
    ...header,
    receiptCount: Number(header.receiptCount),
    lines: lines.map((l) => ({ ...l, kanbanCount: Number(l.kanbanCount) })),
  };
}

/** Tetangga mengikuti urutan daftar terbaru → terlama dan tetap dalam scope sesi. */
export async function getPicklistNeighbors(scope: VendorScope, currentId: number, plantId: number) {
  const db = getDb();
  const columns = {
    publicId: picklistHeaders.publicId,
    picklistNo: picklistHeaders.picklistNo,
    revision: picklistHeaders.revision,
  };
  const base = and(eq(picklistHeaders.plantId, plantId), scopeVendor(scope));
  const [previousRows, nextRows] = await Promise.all([
    db
      .select(columns)
      .from(picklistHeaders)
      .where(and(base, lt(picklistHeaders.id, currentId)))
      .orderBy(desc(picklistHeaders.id))
      .limit(1),
    db
      .select(columns)
      .from(picklistHeaders)
      .where(and(base, gte(picklistHeaders.id, currentId + 1)))
      .orderBy(asc(picklistHeaders.id))
      .limit(1),
  ]);
  const map = (row: (typeof previousRows)[number] | undefined) =>
    row
      ? {
          publicId: row.publicId,
          label: orderSheetDisplayNo(row.picklistNo, row.revision),
        }
      : null;
  return { previous: map(previousRows[0]), next: map(nextRows[0]) };
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
  const [vendorRows, cutoffRows, vendorPartRows, poRows] = await Promise.all([
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
        partId: vendorParts.partId,
        partNo: parts.partNo,
        partName: parts.name,
        backNo: vendorParts.backNo,
        qtyPerBox: vendorParts.qtyPerBox,
      })
      .from(vendorParts)
      .innerJoin(parts, eq(vendorParts.partId, parts.id))
      .where(and(eq(vendorParts.isActive, true), eq(parts.isActive, true)))
      .orderBy(asc(parts.partNo)),
    db
      .select({
        vendorId: poHeaders.vendorId,
        partId: poLines.partId,
        validFrom: poHeaders.validFrom,
        validTo: poHeaders.validTo,
        openQty: poLines.openQty,
      })
      .from(poLines)
      .innerJoin(poHeaders, eq(poLines.poId, poHeaders.id))
      .where(gte(poLines.openQty, 1)),
  ]);

  return vendorRows.map((v) => ({
    ...v,
    cutoffs: cutoffRows.filter((c) => c.vendorId === v.id),
    parts: vendorPartRows
      .filter((p) => p.vendorId === v.id)
      .map((part) => ({
        ...part,
        poWindows: poRows.filter((po) => po.vendorId === v.id && po.partId === part.partId),
      })),
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
export async function getReceiptCounts(plantId: number) {
  const db = getDb();
  const awalHari = new Date(`${hariIniJakarta()}T00:00:00+07:00`);
  const [terbuka, ditutup, box] = await Promise.all([
    db
      .select({ value: count() })
      .from(receiptHeaders)
      .where(and(eq(receiptHeaders.status, 'OPEN'), eq(receiptHeaders.plantId, plantId))),
    db
      .select({ value: count() })
      .from(receiptHeaders)
      .where(
        and(
          eq(receiptHeaders.status, 'CLOSED'),
          gte(receiptHeaders.closedAt, awalHari),
          eq(receiptHeaders.plantId, plantId),
        ),
      ),
    db
      .select({
        value: sql<number>`coalesce(sum((select coalesce(sum(rl.BOX_RECEIVED),0) from TT_RECEIPT_L rl where rl.RECEIPT_ID = TT_RECEIPT_H.ID)),0)`,
      })
      .from(receiptHeaders)
      .where(
        and(
          eq(receiptHeaders.status, 'CLOSED'),
          gte(receiptHeaders.closedAt, awalHari),
          eq(receiptHeaders.plantId, plantId),
        ),
      ),
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
  plantId: number;
  status?: ReceiptStatus;
}) {
  const db = getDb();
  const where = and(
    eq(receiptHeaders.plantId, opts.plantId),
    opts.status ? eq(receiptHeaders.status, opts.status) : undefined,
  );
  const [rows, totalRows] = await Promise.all([
    db
      .select({
        id: receiptHeaders.id,
        publicId: receiptHeaders.publicId,
        receiptNo: receiptHeaders.receiptNo,
        status: receiptHeaders.status,
        openedAt: receiptHeaders.createdAt,
        closedAt: receiptHeaders.closedAt,
        picklistId: picklistHeaders.id,
        picklistPublicId: picklistHeaders.publicId,
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
export async function getReceiptDetail(reference: string, plantId: number) {
  const db = getDb();
  const [r] = await db
    .select({
      id: receiptHeaders.id,
      publicId: receiptHeaders.publicId,
      receiptNo: receiptHeaders.receiptNo,
      status: receiptHeaders.status,
      openedAt: receiptHeaders.createdAt,
      closedAt: receiptHeaders.closedAt,
      note: receiptHeaders.note,
      closedBy: users.name,
      picklistId: picklistHeaders.id,
      picklistPublicId: picklistHeaders.publicId,
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
    .where(and(receiptReference(reference), eq(receiptHeaders.plantId, plantId)))
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
        boxScanned: boxScannedExpr(r.id),
        boxMissing: sql<number>`(select count(*) from TM_KANBAN k where k.PICKLIST_LINE_ID = TT_PICKLIST_L.ID and k.STATUS = 'MISSING')`,
        pcsReceived: sql<number>`(select coalesce(sum(rl.PCS_RECEIVED),0) from TT_RECEIPT_L rl where rl.PICKLIST_LINE_ID = TT_PICKLIST_L.ID and rl.RECEIPT_ID = ${r.id})`,
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
          eq(sapOutbox.sourceId, r.id),
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

// ─── Konsumsi MES dan antrean order (F-10–F-12) ───────────────────────────

export async function listConsumptions(opts: {
  q?: string;
  line?: string;
  from?: string;
  to?: string;
}) {
  const db = getDb();
  return db
    .select({
      id: consumptions.id,
      sourceKey: consumptions.sourceKey,
      sourceRecordKey: consumptions.sourceRecordKey,
      firstConsumptionId: sql<number>`(select min(c.ID) from TT_CONSUMPTION c where c.SOURCE_RECORD_KEY = ${consumptions.sourceRecordKey} and c.QTY > 0)`,
      reversedAt: sql<Date | null>`(select max(c.CREATED_AT) from TT_CONSUMPTION c where c.SOURCE_RECORD_KEY = ${consumptions.sourceRecordKey} and c.QTY < 0)`,
      closedQueueCount: sql<number>`(select count(*) from TT_CONSUMPTION c join TT_ORDER_QUEUE q on q.ID = c.QUEUE_ID where c.SOURCE_RECORD_KEY = ${consumptions.sourceRecordKey} and c.QTY > 0 and q.STATUS = 'CLOSED')`,
      parentPartNo: sql<string>`(select p.PART_NO from TM_PARTS p where p.ID = ${consumptions.parentPartId})`,
      componentPartNo: parts.partNo,
      componentName: parts.name,
      qty: consumptions.qty,
      line: consumptions.line,
      occurredAt: consumptions.occurredAt,
      vendorName: vendors.name,
      cutoffAt: orderQueues.cutoffAt,
    })
    .from(consumptions)
    .innerJoin(parts, eq(consumptions.componentPartId, parts.id))
    .innerJoin(orderQueues, eq(consumptions.queueId, orderQueues.id))
    .innerJoin(vendorParts, eq(orderQueues.vendorPartId, vendorParts.id))
    .innerJoin(vendors, eq(vendorParts.vendorId, vendors.id))
    .where(
      and(
        sql`${consumptions.qty} > 0`,
        opts.q
          ? or(
              like(parts.partNo, `%${opts.q}%`),
              like(parts.name, `%${opts.q}%`),
              sql`exists (select 1 from TM_PARTS p where p.ID = ${consumptions.parentPartId} and (p.PART_NO like ${`%${opts.q}%`} or p.NAME like ${`%${opts.q}%`}))`,
            )
          : undefined,
        opts.line ? eq(consumptions.line, opts.line) : undefined,
        opts.from
          ? gte(consumptions.occurredAt, new Date(`${opts.from}T00:00:00+07:00`))
          : undefined,
        opts.to
          ? lt(
              consumptions.occurredAt,
              new Date(new Date(`${opts.to}T00:00:00+07:00`).getTime() + 86_400_000),
            )
          : undefined,
      ),
    )
    .orderBy(desc(consumptions.occurredAt), desc(consumptions.id))
    .limit(200);
}

export async function listConsumptionFailures(opts: {
  q?: string;
  line?: string;
  from?: string;
  to?: string;
}) {
  const db = getDb();
  return db
    .select()
    .from(mesFailures)
    .where(
      and(
        opts.q
          ? or(like(mesFailures.partNo, `%${opts.q}%`), like(mesFailures.error, `%${opts.q}%`))
          : undefined,
        opts.line ? eq(mesFailures.line, opts.line) : undefined,
        opts.from
          ? gte(mesFailures.occurredAt, new Date(`${opts.from}T00:00:00+07:00`))
          : undefined,
        opts.to
          ? lt(
              mesFailures.occurredAt,
              new Date(new Date(`${opts.to}T00:00:00+07:00`).getTime() + 86_400_000),
            )
          : undefined,
      ),
    )
    .orderBy(desc(mesFailures.updatedAt))
    .limit(200);
}

/**
 * Antrean OPEN, satu halaman.
 *
 * Total pcs dihitung lewat agregat terpisah, bukan dari baris yang tampil:
 * ringkasan di kepala halaman harus tetap menyebut seluruh antrean walau layar
 * hanya menampilkan 50 baris. Tanpa limit, satu shift MES yang ramai bisa
 * menaruh ribuan vendor part di satu tabel.
 */
export async function listOpenOrderQueues(opts: { page: number; perPage: number }) {
  const db = getDb();
  const where = eq(orderQueues.status, 'OPEN');
  const [rows, ringkasan] = await Promise.all([
    db
      .select({
        id: orderQueues.id,
        vendorName: vendors.name,
        partNo: parts.partNo,
        partName: parts.name,
        backNo: vendorParts.backNo,
        qtyPerBox: vendorParts.qtyPerBox,
        pcs: orderQueues.pcs,
        carryOverPcs: orderQueues.carryOverPcs,
        hold: orderQueues.hold,
        blockedReason: orderQueues.blockedReason,
        blockedAt: orderQueues.blockedAt,
        cutoffAt: orderQueues.cutoffAt,
        updatedAt: orderQueues.updatedAt,
      })
      .from(orderQueues)
      .innerJoin(vendorParts, eq(orderQueues.vendorPartId, vendorParts.id))
      .innerJoin(parts, eq(vendorParts.partId, parts.id))
      .innerJoin(vendors, eq(vendorParts.vendorId, vendors.id))
      .where(where)
      .orderBy(asc(orderQueues.cutoffAt), asc(vendors.name), asc(parts.partNo))
      .limit(opts.perPage)
      .offset((opts.page - 1) * opts.perPage),
    db
      .select({
        total: count(),
        pcs: sql<number>`coalesce(sum(${orderQueues.pcs} + ${orderQueues.carryOverPcs}), 0)`,
      })
      .from(orderQueues)
      .where(where),
  ]);

  const total = ringkasan[0]?.total ?? 0;
  return {
    data: rows.map((row) => ({
      ...row,
      boxes: Math.round(((row.pcs + row.carryOverPcs) / row.qtyPerBox) * 100) / 100,
    })),
    meta: {
      page: opts.page,
      perPage: opts.perPage,
      total,
      totalPages: Math.max(1, Math.ceil(total / opts.perPage)),
      pcs: Number(ringkasan[0]?.pcs ?? 0),
    },
  };
}

// ─── Stok WH (F-41) ─────────────────────────────────────────────────────────

/**
 * Saldo per part = SUM(DELTA_PCS) TT_STOCK_MUTATION (aturan repo 7); tidak ada
 * kolom saldo. Ekuivalen box memakai QTY_PER_BOX vendor part aktif — bila satu
 * part dipasok beberapa supplier dengan kemasan berbeda, dipakai yang terkecil
 * dan supplier lainnya tetap disebut.
 */
/**
 * Saldo stok per part (F-41), satu halaman.
 *
 * Saldo dibaca dari snapshot harian terakhir ditambah mutasi sejak tanggal itu,
 * bukan dengan menjumlahkan seluruh TT_STOCK_MUTATION. Pada 2 juta baris, cara
 * lama makan 0,5–1,2 detik per pembukaan layar dan tabel itu hanya bertambah.
 *
 * Belum ada snapshot sama sekali (pemasangan baru, atau job belum sempat
 * jalan) → otomatis kembali menjumlahkan seluruh riwayat. Angkanya tetap benar,
 * hanya lebih lambat, dan pulih sendiri begitu job harian berjalan.
 */
export async function listStock(opts: {
  plantId: number;
  vendorId?: number;
  q?: string;
  page: number;
  perPage: number;
}) {
  const db = getDb();
  const [snapshotTerakhir] = await db
    .select({ asOf: stockSnapshots.asOf })
    .from(stockSnapshots)
    .where(eq(stockSnapshots.plantId, opts.plantId))
    .orderBy(desc(stockSnapshots.asOf))
    .limit(1);
  const asOf = snapshotTerakhir?.asOf ?? null;
  const sejak = asOf ? new Date(`${asOf}T00:00:00+07:00`) : null;

  // Mutasi setelah snapshot saja. Dengan TT_STOCK_MUTATION_PLANT_TIME_IDX,
  // MySQL membacanya dari index tanpa menyentuh barisnya.
  const selisih = db
    .select({
      partId: stockMutations.partId,
      deltaPcs: sql<number>`sum(${stockMutations.deltaPcs})`.as('DELTA_PCS_SUM'),
      mutations: count().as('MUTATION_COUNT_SUM'),
      lastAt: sql<Date | null>`max(${stockMutations.occurredAt})`.as('LAST_AT_MAX'),
    })
    .from(stockMutations)
    .where(
      and(
        eq(stockMutations.plantId, opts.plantId),
        sejak ? gte(stockMutations.occurredAt, sejak) : undefined,
      ),
    )
    .groupBy(stockMutations.partId)
    .as('selisih');

  const beku = db
    .select({
      partId: stockSnapshots.partId,
      balancePcs: stockSnapshots.balancePcs,
      mutations: stockSnapshots.mutationCount,
      lastAt: stockSnapshots.lastAt,
    })
    .from(stockSnapshots)
    .where(
      and(
        eq(stockSnapshots.plantId, opts.plantId),
        asOf ? eq(stockSnapshots.asOf, asOf) : sql`1 = 0`,
      ),
    )
    .as('beku');

  const pcsExpr = sql<number>`coalesce(${beku.balancePcs}, 0) + coalesce(${selisih.deltaPcs}, 0)`;
  const where = and(
    // Part tanpa snapshot dan tanpa mutasi tidak punya stok — tidak ditampilkan.
    sql`(${beku.partId} is not null or ${selisih.partId} is not null)`,
    opts.vendorId
      ? sql`exists (select 1 from TM_VENDOR_PARTS vp where vp.PART_ID = TM_PARTS.ID and vp.VENDOR_ID = ${opts.vendorId})`
      : undefined,
    opts.q ? or(like(parts.partNo, `%${opts.q}%`), like(parts.name, `%${opts.q}%`)) : undefined,
  );

  const dasar = () =>
    db
      .select({
        partId: parts.id,
        partNo: parts.partNo,
        partName: parts.name,
        uom: parts.uom,
        pcs: pcsExpr,
        mutations: sql<number>`coalesce(${beku.mutations}, 0) + coalesce(${selisih.mutations}, 0)`,
        lastAt: sql<Date | null>`greatest(coalesce(${beku.lastAt}, ${selisih.lastAt}), coalesce(${selisih.lastAt}, ${beku.lastAt}))`,
        qtyPerBox: sql<
          number | null
        >`(select min(vp.QTY_PER_BOX) from TM_VENDOR_PARTS vp where vp.PART_ID = TM_PARTS.ID and vp.IS_ACTIVE = 1)`,
        vendors: sql<
          string | null
        >`(select group_concat(distinct v.NAME order by v.NAME separator ', ') from TM_VENDOR_PARTS vp join TM_VENDOR v on v.ID = vp.VENDOR_ID where vp.PART_ID = TM_PARTS.ID and vp.IS_ACTIVE = 1)`,
      })
      .from(parts)
      .leftJoin(beku, eq(beku.partId, parts.id))
      .leftJoin(selisih, eq(selisih.partId, parts.id))
      .where(where);

  const [rows, ringkasan] = await Promise.all([
    dasar()
      .orderBy(asc(parts.partNo))
      .limit(opts.perPage)
      .offset((opts.page - 1) * opts.perPage),
    // Kartu ringkasan menyebut SELURUH saringan, bukan halaman yang tampil.
    db
      .select({
        total: count(),
        pcs: sql<number>`coalesce(sum(${pcsExpr}), 0)`,
        negatif: sql<number>`sum(case when ${pcsExpr} < 0 then 1 else 0 end)`,
      })
      .from(parts)
      .leftJoin(beku, eq(beku.partId, parts.id))
      .leftJoin(selisih, eq(selisih.partId, parts.id))
      .where(where),
  ]);

  const total = ringkasan[0]?.total ?? 0;
  return {
    data: rows.map((r) => {
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
    }),
    meta: {
      page: opts.page,
      perPage: opts.perPage,
      total,
      totalPages: Math.max(1, Math.ceil(total / opts.perPage)),
      pcs: Number(ringkasan[0]?.pcs ?? 0),
      negatif: Number(ringkasan[0]?.negatif ?? 0),
      asOf,
    },
  };
}

/** Buku mutasi satu part, terbaru dulu — rujukan dokumen ikut dibawa. */
export async function getStockLedger(partId: number, plantId: number, limit = 100) {
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
        receiptPublicId: sql<
          string | null
        >`(select rh.PUBLIC_ID from TT_RECEIPT_L rl join TT_RECEIPT_H rh on rh.ID = rl.RECEIPT_ID where rl.ID = TT_STOCK_MUTATION.REF_ID and TT_STOCK_MUTATION.REF_TABLE = 'TT_RECEIPT_L')`,
        receiptNo: sql<
          string | null
        >`(select rh.RECEIPT_NO from TT_RECEIPT_L rl join TT_RECEIPT_H rh on rh.ID = rl.RECEIPT_ID where rl.ID = TT_STOCK_MUTATION.REF_ID and TT_STOCK_MUTATION.REF_TABLE = 'TT_RECEIPT_L')`,
      })
      .from(stockMutations)
      .leftJoin(users, eq(stockMutations.userId, users.id))
      .where(and(eq(stockMutations.partId, partId), eq(stockMutations.plantId, plantId)))
      .orderBy(desc(stockMutations.occurredAt), desc(stockMutations.id))
      .limit(limit),
    db
      .select({ pcs: sql<number>`coalesce(sum(${stockMutations.deltaPcs}), 0)` })
      .from(stockMutations)
      .where(and(eq(stockMutations.partId, partId), eq(stockMutations.plantId, plantId))),
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

/**
 * Vendor part milik satu supplier, untuk portal (aturan repo 9: vendorId dari
 * sesi ikut di WHERE, bukan hanya menyembunyikan menu). Hanya baris aktif —
 * yang dinonaktifkan PPIC bukan urusan supplier lagi.
 */
export async function listVendorPartsForVendor(vendorId: number) {
  const db = getDb();
  return db
    .select({
      id: vendorParts.id,
      partNo: parts.partNo,
      partName: parts.name,
      uom: parts.uom,
      qtyPerBox: vendorParts.qtyPerBox,
      backNo: vendorParts.backNo,
      rack: vendorParts.rack,
      boxType: vendorParts.boxType,
      updatedAt: vendorParts.updatedAt,
    })
    .from(vendorParts)
    .innerJoin(parts, eq(vendorParts.partId, parts.id))
    .where(and(eq(vendorParts.vendorId, vendorId), eq(vendorParts.isActive, true)))
    .orderBy(asc(parts.partNo));
}

export type VendorPartRow = Awaited<ReturnType<typeof listVendorPartsForVendor>>[number];
