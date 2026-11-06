import { poPeriodForDate } from './picklist';

/** Proyeksi tabel staging; nilai char tetap berupa string supaya nol depan tidak hilang. */
export interface SapPoRow {
  poNo: string; vendorNo: string | null; createdDate: string | null; status: string | null;
  headerDeleted: string | null; closed: string | null; error: string | null;
  item: number | string | null; material: string | null; quantity: string | null;
  uom: string | null; plant: string | null; lineDeleted: string | null;
}

export function normalizeSapPo(row: SapPoRow) {
  const poNo = row.poNo.trim();
  const vendorNo = row.vendorNo?.trim() ?? '';
  const material = row.material?.trim() ?? '';
  if (!poNo || poNo.length > 16 || !vendorNo || !material) throw new Error('Nomor PO, supplier, atau material kosong/tidak valid');
  // Keputusan 2026-11-03: PO dibuat SAP bulan M (CHR_CREATE_DATE, bukan
  // CREATE_DATE2) dan ditarik tanggal tarik bulan M untuk order bulan M+1.
  const rawDate = row.createdDate?.trim() ?? '';
  if (!/^\d{8}$/.test(rawDate)) throw new Error('Tanggal PO harus berformat YYYYMMDD');
  const date = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`;
  poPeriodForDate(date); // validasi tanggal kalender
  const period = poPeriodForDate(`${addMonths(date.slice(0, 7), 1)}-01`);
  const item = String(row.item ?? '').trim();
  if (!/^\d{1,5}$/.test(item) || Number(item) <= 0) throw new Error('Item PO tidak valid');
  const quantity = row.quantity?.trim() ?? '';
  // 10.000 dari staging berarti 10 pcs, bukan 10 ribu; pecahan/comma tidak dibulatkan.
  if (!/^\d+(?:\.0+)?$/.test(quantity)) throw new Error('Jumlah awal PO harus bilangan bulat nonnegatif');
  const orderedQty = Number(quantity);
  if (!Number.isSafeInteger(orderedQty) || orderedQty > 2_147_483_647) throw new Error('Jumlah awal PO melewati batas ARES');
  const uom = row.uom?.trim().toUpperCase() ?? '';
  const plant = row.plant?.trim() ?? '';
  if (!uom || uom.length > 8 || !plant || plant.length > 4) throw new Error('Satuan atau plant SAP belum lengkap');
  const inactive = [row.headerDeleted, row.closed, row.error, row.lineDeleted]
    .some((flag) => !['', '0'].includes(flag?.trim() ?? ''));
  return { poNo, vendorNo, material, item: item.padStart(5, '0'), orderedQty, uom, plant, inactive, ...period };
}

export function samePoUnit(sapUnit: string, localUnit: string): boolean {
  const normalize = (unit: string) => ['PC', 'PCS'].includes(unit.trim().toUpperCase()) ? 'PCS' : unit.trim().toUpperCase();
  return normalize(sapUnit) === normalize(localUnit);
}

export function sapPoMonth(now = new Date()): string {
  return new Date(now.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 7);
}

/** 'YYYY-MM' + n bulan (boleh negatif). */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

/** Tanggal tarik PO yang boleh dipilih admin: 1–28, supaya ada di setiap bulan. */
export function isValidPoPullDay(day: number): boolean {
  return Number.isInteger(day) && day >= 1 && day <= 28;
}

/**
 * Jadwal tarik PO (F-44): pada tanggal tarik (WIB), PO bulan berikutnya
 * ditarik. Selain tanggal itu tidak ada yang ditarik; tarik manual tetap ada
 * di layar SAP kalau server mati tepat di tanggalnya.
 */
export function poPullTarget(now: Date, pullDay: number): string | null {
  if (!isValidPoPullDay(pullDay)) throw new Error('Tanggal tarik PO harus 1–28');
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return wib.getUTCDate() === pullDay ? addMonths(wib.toISOString().slice(0, 7), 1) : null;
}
