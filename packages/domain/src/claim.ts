/**
 * Order Sheet claim: ganti barang rusak yang ketahuan setelah diterima.
 *
 * Alur: order → barang diterima → ada barang rusak → order claim sejumlah box
 * rusak → barang rusak dikembalikan ke supplier → supplier kirim gantinya →
 * diterima tanpa scan. Order asal sudah diterima penuh dan GR-nya sudah masuk
 * SAP, jadi claim tidak pernah diangkat ke SAP lagi.
 *
 * Qty memakai satuan kanban (box), sama seperti order lain; pcs-nya ikut
 * qty per box milik line asal.
 */

export class ClaimError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClaimError';
  }
}

export interface ClaimSourceLine {
  picklistLineId: number;
  qtyPerBox: number;
  /** Box yang benar-benar diterima di order asal — batas atas box rusak. */
  boxReceived: number;
  /** Box line ini yang sudah pernah diklaim sebelumnya. */
  boxClaimed: number;
}

export interface ClaimRequestLine {
  picklistLineId: number;
  damagedBox: number;
}

export interface ClaimLineResult {
  picklistLineId: number;
  /** Box rusak = box yang harus dikirim ulang supplier. */
  boxOrdered: number;
  pcs: number;
}

/** Validasi box rusak terhadap yang pernah diterima; melempar ClaimError bila tidak masuk akal. */
export function planClaim(
  source: readonly ClaimSourceLine[],
  requested: readonly ClaimRequestLine[],
): ClaimLineResult[] {
  const byId = new Map(source.map((line) => [line.picklistLineId, line]));
  const seen = new Set<number>();
  const result: ClaimLineResult[] = [];

  for (const line of requested) {
    if (line.damagedBox === 0) continue;
    const src = byId.get(line.picklistLineId);
    if (!src) throw new ClaimError(`Line ${line.picklistLineId} bukan bagian dari order asal`);
    if (seen.has(line.picklistLineId)) {
      throw new ClaimError(`Line ${line.picklistLineId} diisi dua kali`);
    }
    seen.add(line.picklistLineId);
    if (!Number.isInteger(line.damagedBox) || line.damagedBox < 0) {
      throw new ClaimError(`Box rusak line ${line.picklistLineId} harus bilangan bulat ≥ 0`);
    }
    const sisa = src.boxReceived - src.boxClaimed;
    if (line.damagedBox > sisa) {
      throw new ClaimError(
        `Box rusak line ${line.picklistLineId} (${line.damagedBox}) melebihi yang masih bisa diklaim (${sisa})`,
      );
    }
    if (src.qtyPerBox < 1) throw new ClaimError(`Qty per box line ${line.picklistLineId} tidak valid`);
    result.push({
      picklistLineId: line.picklistLineId,
      boxOrdered: line.damagedBox,
      pcs: line.damagedBox * src.qtyPerBox,
    });
  }

  if (result.length === 0) throw new ClaimError('Claim tanpa satu pun box rusak');
  return result;
}

export interface ClaimReceiptLine {
  picklistLineId: number;
  /** Box yang diorder di claim. */
  boxOrdered: number;
  /** Box yang sudah diterima dari claim ini sebelumnya. */
  boxReceived: number;
  qtyPerBox: number;
}

export interface ClaimReceiptResult {
  picklistLineId: number;
  boxReceived: number;
  pcsReceived: number;
  /** Semua box claim sudah datang. */
  complete: boolean;
}

/**
 * Penerimaan barang claim — tanpa scan kanban: nomor order asal sudah diterima
 * penuh dan kartu kanbannya habis terpakai, jadi PPIC yang mencatat jumlahnya.
 */
export function receiveClaim(
  lines: readonly ClaimReceiptLine[],
  requested: ReadonlyMap<number, number>,
): { lines: ClaimReceiptResult[]; complete: boolean } {
  const rows = lines.map((line): ClaimReceiptResult => {
    const box = requested.get(line.picklistLineId) ?? 0;
    if (!Number.isInteger(box) || box < 0) {
      throw new ClaimError(`Box diterima line ${line.picklistLineId} harus bilangan bulat ≥ 0`);
    }
    const total = line.boxReceived + box;
    if (total > line.boxOrdered) {
      throw new ClaimError(
        `Box diterima line ${line.picklistLineId} (${total}) melebihi box claim (${line.boxOrdered})`,
      );
    }
    return {
      picklistLineId: line.picklistLineId,
      boxReceived: box,
      pcsReceived: box * line.qtyPerBox,
      complete: total === line.boxOrdered,
    };
  });
  if (rows.every((row) => row.boxReceived === 0)) {
    throw new ClaimError('Penerimaan claim tanpa satu pun box');
  }
  return { lines: rows, complete: rows.every((row) => row.complete) };
}
