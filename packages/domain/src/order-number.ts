/** Nomor plant pada Order Sheet sesuai standar AIIA. */
const PLANT_INITIAL: Readonly<Record<string, string>> = {
  BODY: '7',
  UNIT: '8',
  ELECTRIC: '9',
};

export class OrderNumberError extends Error {}

export function orderPlantInitial(plantCode: string): string {
  const initial = PLANT_INITIAL[plantCode.trim().toUpperCase()];
  if (!initial) throw new OrderNumberError(`Kode plant ${plantCode} belum memiliki initial Order Sheet`);
  return initial;
}

/**
 * Format nomor Order Sheet: P + YYMMDD + NNN + RR.
 * P = initial plant, NNN = urutan pembuatan order pada tanggal delivery,
 * RR = urutan recovery/revisi.
 */
export function formatOrderSheetNo(
  plantCode: string,
  deliveryDate: string,
  sequence: number,
  recovery = 0,
): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate)) {
    throw new OrderNumberError('Tanggal delivery harus YYYY-MM-DD');
  }
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 999) {
    throw new OrderNumberError('Urutan Order Sheet harus 1–999');
  }
  if (!Number.isInteger(recovery) || recovery < 0 || recovery > 99) {
    throw new OrderNumberError('Urutan recovery harus 0–99');
  }
  const yymmdd = deliveryDate.slice(2).replaceAll('-', '');
  return `${orderPlantInitial(plantCode)}${yymmdd}${String(sequence).padStart(3, '0')}${String(recovery).padStart(2, '0')}`;
}

/** Nomor yang ditampilkan. Nomor lama PL-* tetap memakai suffix `rev`. */
export function orderSheetDisplayNo(baseNo: string, revision: number): string {
  if (/^[789]\d{11}$/.test(baseNo)) {
    if (!Number.isInteger(revision) || revision < 0 || revision > 99) {
      throw new OrderNumberError('Urutan recovery harus 0–99');
    }
    return `${baseNo.slice(0, -2)}${String(revision).padStart(2, '0')}`;
  }
  return revision > 0 ? `${baseNo} rev ${revision}` : baseNo;
}

/** Nomor dasar yang disimpan di database dari nomor recovery yang dipindai. */
export function orderSheetBaseNo(displayNo: string): { baseNo: string; revision: number } | null {
  if (!/^[789]\d{11}$/.test(displayNo)) return null;
  return {
    baseNo: `${displayNo.slice(0, -2)}00`,
    revision: Number(displayNo.slice(-2)),
  };
}
