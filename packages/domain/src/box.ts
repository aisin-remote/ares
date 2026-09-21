/**
 * PRD 6.1 — konversi antrean (pcs) ke box saat cutoff.
 *
 * Fungsi murni: service cutoff (fase 2) dan order manual memanggilnya dengan
 * data antrean satu supplier, lalu menyimpan hasilnya sebagai baris picklist
 * dan carry-over baru.
 */
import type { Rounding } from '@ares/contracts';

/** Satu vendor part dalam antrean menjelang cutoff. */
export interface QueueInput {
  vendorPartId: number;
  /** Akumulasi konsumsi sejak cutoff terakhir (F-12). */
  queuePcs: number;
  /** Sisa dari cutoff sebelumnya. */
  carryOverPcs: number;
  qtyPerBox: number;
  /** F-13: di-hold PPIC → dilewati, antrean tidak disentuh (6.1.4). */
  hold?: boolean;
}

export interface QueueResult {
  vendorPartId: number;
  /** 0 = tidak masuk picklist (6.1.3) atau di-hold (6.1.4). */
  boxes: number;
  /** Pcs yang diorder = boxes × qtyPerBox. */
  pcs: number;
  /** Carry-over baru; untuk hold: nilai lama, jangan ditulis ulang. */
  carryOverPcs: number;
  held: boolean;
}

/** 6.1.2: `floor` sisa jadi carry-over (default); `ceil` bulat ke atas tanpa carry-over (F-07). */
export function pcsToBoxes(
  totalPcs: number,
  qtyPerBox: number,
  rounding: Rounding = 'FLOOR',
): { boxes: number; carryOverPcs: number } {
  if (!Number.isInteger(qtyPerBox) || qtyPerBox <= 0) {
    throw new Error(`qtyPerBox harus bilangan bulat positif, dapat ${qtyPerBox}`);
  }
  // Antrean nol/negatif (hasil koreksi PPIC, F-13) tidak menghasilkan box;
  // nilainya dibawa apa adanya supaya koreksi tidak hilang.
  if (totalPcs <= 0) return { boxes: 0, carryOverPcs: totalPcs };
  if (rounding === 'CEIL') return { boxes: Math.ceil(totalPcs / qtyPerBox), carryOverPcs: 0 };
  return { boxes: Math.floor(totalPcs / qtyPerBox), carryOverPcs: totalPcs % qtyPerBox };
}

/**
 * 6.1: seluruh antrean satu supplier pada satu cutoff → satu picklist (6.1.5).
 * Pemanggil mengambil `boxes > 0` sebagai baris picklist dan menyimpan
 * `carryOverPcs` untuk yang tidak di-hold.
 */
export function planPicklist(items: readonly QueueInput[], rounding: Rounding = 'FLOOR'): QueueResult[] {
  return items.map((it) => {
    if (it.hold) {
      return { vendorPartId: it.vendorPartId, boxes: 0, pcs: 0, carryOverPcs: it.carryOverPcs, held: true };
    }
    const { boxes, carryOverPcs } = pcsToBoxes(it.queuePcs + it.carryOverPcs, it.qtyPerBox, rounding);
    return { vendorPartId: it.vendorPartId, boxes, pcs: boxes * it.qtyPerBox, carryOverPcs, held: false };
  });
}
