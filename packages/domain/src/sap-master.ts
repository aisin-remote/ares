/**
 * Sinkron master supplier, part, dan vendor part dari staging SAP (F-01, F-02).
 * Fungsi murni: gateway membaca A_DB_STG apa adanya (kolom char berpadding),
 * service memanggil ini lalu menulis ke master ARES.
 */

export interface SapVendorRow {
  supplierId: string | null; name: string | null; address: string | null; deleted: string | null;
}
export interface SapPartRow {
  material: string | null; name: string | null; uom: string | null; partNoDash: string | null;
  backNo: string | null; boxType: string | null; qtyPerBox: number | null; deleted: string | null;
}
export interface SapVendorPartRow { supplierId: string | null; material: string | null }
export interface SapKanbanRow {
  material: string | null; wcVendor: string | null; backNo: string | null; boxType: string | null;
  qtyPerBox: number | null; rack: string | null; deleted: string | null;
}

const text = (value: string | null | undefined) => value?.trim() ?? '';
/** Flag hapus SAP: kosong atau '0' berarti aktif. */
const isDeleted = (flag: string | null) => !['', '0'].includes(text(flag));

export function normalizeSapVendor(row: SapVendorRow) {
  const sapVendorNo = text(row.supplierId);
  const name = text(row.name);
  if (!sapVendorNo || sapVendorNo.length > 16) throw new Error('Kode supplier SAP kosong/tidak valid');
  if (!name) throw new Error(`Nama supplier ${sapVendorNo} kosong`);
  return { sapVendorNo, name: name.slice(0, 128), address: text(row.address).slice(0, 255) || null, isActive: !isDeleted(row.deleted) };
}

/** Nomor tampilan memakai nomor berdash SAP bila ada; material SAP tetap kunci (lihat SAP-MM-MAPPING §2). */
export function normalizeSapPart(row: SapPartRow) {
  const sapMaterialNo = text(row.material);
  const name = text(row.name);
  if (!sapMaterialNo || sapMaterialNo.length > 40) throw new Error('Nomor material SAP kosong/tidak valid');
  if (!name) throw new Error(`Nama part ${sapMaterialNo} kosong`);
  const uom = text(row.uom).toUpperCase() || 'PC';
  if (uom.length > 16) throw new Error(`Satuan part ${sapMaterialNo} terlalu panjang`);
  return {
    sapMaterialNo,
    partNo: (text(row.partNoDash) || sapMaterialNo).slice(0, 64),
    name: name.slice(0, 128),
    uom,
    isActive: !isDeleted(row.deleted),
  };
}

/**
 * Kemasan untuk vendor part BARU: kartu kanban SAP milik supplier itu lebih
 * dulu, lalu nilai di master part. Null bila qty per box atau back number
 * tidak ada — PPIC melengkapinya manual, ARES tidak menebak.
 */
export function pickSapPackaging(
  supplierId: string,
  part: Pick<SapPartRow, 'backNo' | 'boxType' | 'qtyPerBox'>,
  kanbans: readonly SapKanbanRow[],
): { qtyPerBox: number; backNo: string; boxType: string | null; rack: string | null } | null {
  const kanban = kanbans.find((k) => !isDeleted(k.deleted) && text(k.wcVendor) === supplierId && (k.qtyPerBox ?? 0) > 0);
  const qtyPerBox = kanban?.qtyPerBox ?? part.qtyPerBox ?? 0;
  const backNo = (kanban && text(kanban.backNo)) || text(part.backNo);
  if (!Number.isInteger(qtyPerBox) || qtyPerBox <= 0 || !backNo) return null;
  return {
    qtyPerBox,
    backNo: backNo.slice(0, 32),
    boxType: ((kanban && text(kanban.boxType)) || text(part.boxType)).slice(0, 32) || null,
    rack: (kanban && text(kanban.rack).slice(0, 32)) || null,
  };
}
