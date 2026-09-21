/**
 * PRD 6.3 — konfirmasi kirim supplier dan short shipment (F-30, F-25).
 *
 * Fungsi murni: service picklist memuat line + kanban, memanggil ini, lalu
 * menulis status kanban/line/header dan (bila REVISION) membuat revisi.
 */
import type { KanbanStatus, ShortShipPolicy } from '@ares/contracts';

export interface ShipmentLineInput {
  picklistLineId: number;
  boxOrdered: number;
  /** Diisi supplier (6.3.1): 0 ≤ boxShipped ≤ boxOrdered. */
  boxShipped: number;
  kanbans: ReadonlyArray<{ id: string; serial: number; status: KanbanStatus }>;
}

export interface ShipmentLineResult {
  picklistLineId: number;
  boxShipped: number;
  boxShort: number;
  /** SHORT bila ada sisa (6.3.2); OPEN bila penuh. */
  status: 'OPEN' | 'SHORT';
  /** PRINTED → SHIPPED. */
  shippedKanbanIds: string[];
  /** Sisa: CANCELLED (CARRY_OVER) atau tetap PRINTED dan pindah ke revisi (REVISION). */
  shortKanbanIds: string[];
}

export interface ShipmentResult {
  policy: ShortShipPolicy;
  short: boolean;
  lines: ShipmentLineResult[];
  /** CARRY_OVER: kanban sisa yang harus CANCELLED. Pcs kembali ke antrean = boxShort × qtyPerBox per line. */
  cancelledKanbanIds: string[];
  /** REVISION: line revisi berikutnya beserta kanban yang ikut. */
  revisionLines: Array<{ picklistLineId: number; boxes: number; kanbanIds: string[] }>;
}

/** Konfirmasi yang tidak sah: pesannya layak ditampilkan ke supplier. */
export class ShipmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShipmentError';
  }
}

export function confirmShipment(
  lines: readonly ShipmentLineInput[],
  policy: ShortShipPolicy,
): ShipmentResult {
  const results = lines.map((line): ShipmentLineResult => {
    const n = line.boxShipped;
    if (!Number.isInteger(n) || n < 0) {
      throw new ShipmentError(`Box dikirim line ${line.picklistLineId} harus bilangan bulat ≥ 0`);
    }
    if (n > line.boxOrdered) {
      throw new ShipmentError(
        `Box dikirim line ${line.picklistLineId} (${n}) melebihi box diorder (${line.boxOrdered})`,
      );
    }

    // Kanban PRINTED urut serial: yang dikirim serial terkecil dulu, supaya
    // kartu yang ditempel supplier berurutan. Yang sudah RECEIVED (diterima
    // sebelum konfirmasi, catatan 6.4) sudah terhitung terkirim.
    const printed = line.kanbans
      .filter((k) => k.status === 'PRINTED')
      .sort((a, b) => a.serial - b.serial);
    const received = line.kanbans.filter((k) => k.status === 'RECEIVED').length;
    const toShip = n - received;
    if (toShip < 0) {
      throw new ShipmentError(
        `Box dikirim line ${line.picklistLineId} (${n}) kurang dari yang sudah diterima pabrik (${received})`,
      );
    }
    const shipped = printed.slice(0, toShip);
    const rest = printed.slice(toShip);
    const boxShort = line.boxOrdered - n;

    return {
      picklistLineId: line.picklistLineId,
      boxShipped: n,
      boxShort,
      status: boxShort > 0 ? 'SHORT' : 'OPEN',
      shippedKanbanIds: shipped.map((k) => k.id),
      shortKanbanIds: rest.map((k) => k.id),
    };
  });

  if (results.every((r) => r.boxShipped === 0)) {
    throw new ShipmentError('Konfirmasi tanpa satu pun box yang dikirim');
  }

  const shortLines = results.filter((r) => r.boxShort > 0);
  return {
    policy,
    short: shortLines.length > 0,
    lines: results,
    cancelledKanbanIds: policy === 'CARRY_OVER' ? shortLines.flatMap((r) => r.shortKanbanIds) : [],
    revisionLines:
      policy === 'REVISION'
        ? shortLines.map((r) => ({
            picklistLineId: r.picklistLineId,
            boxes: r.boxShort,
            kanbanIds: r.shortKanbanIds,
          }))
        : [],
  };
}
