export class QueueControlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QueueControlError';
  }
}

/** F-13: koreksi manual tidak boleh membuat kebutuhan OPEN menjadi negatif. */
export function applyQueueAdjustment(currentPcs: number, deltaPcs: number): number {
  if (!Number.isInteger(currentPcs) || currentPcs < 0) {
    throw new QueueControlError('PCS antrean saat ini tidak valid');
  }
  if (!Number.isInteger(deltaPcs) || deltaPcs === 0) {
    throw new QueueControlError('Selisih PCS harus bilangan bulat selain nol');
  }
  const next = currentPcs + deltaPcs;
  if (next < 0) throw new QueueControlError('Koreksi membuat PCS antrean negatif');
  return next;
}

/** F-13: PPIC menetapkan jumlah order dalam kanban; penyimpanan tetap PCS untuk MES. */
export function setQueueKanbanQuantity(input: {
  queuePcs: number;
  carryOverPcs: number;
  qtyPerKanban: number;
  kanban: number;
}) {
  const { queuePcs, carryOverPcs, qtyPerKanban, kanban } = input;
  if (![queuePcs, carryOverPcs, qtyPerKanban, kanban].every(Number.isInteger)) {
    throw new QueueControlError('Jumlah antrean dan kanban harus bilangan bulat');
  }
  if (queuePcs < 0 || carryOverPcs < 0) {
    throw new QueueControlError('PCS antrean saat ini tidak valid');
  }
  if (qtyPerKanban <= 0) throw new QueueControlError('Isi per kanban harus lebih dari nol');
  if (kanban < 0) throw new QueueControlError('Jumlah kanban tidak boleh negatif');

  const currentTotalPcs = queuePcs + carryOverPcs;
  const totalPcs = kanban * qtyPerKanban;
  if (!Number.isSafeInteger(totalPcs)) throw new QueueControlError('Jumlah order terlalu besar');
  if (totalPcs === currentTotalPcs) throw new QueueControlError('Jumlah kanban tidak berubah');

  const nextCarryOverPcs = Math.min(carryOverPcs, totalPcs);
  return {
    kanban,
    totalPcs,
    pcs: totalPcs - nextCarryOverPcs,
    carryOverPcs: nextCarryOverPcs,
    deltaPcs: totalPcs - currentTotalPcs,
  };
}

export interface ReversibleConsumption {
  consumptionId: number;
  qty: number;
  queueStatus: 'OPEN' | 'CLOSED';
}

/** F-15: sebelum cutoff, balik konsumsi dan stok dengan besar yang sama. */
export function planConsumptionReversal(rows: readonly ReversibleConsumption[]) {
  if (rows.length === 0) throw new QueueControlError('Record konsumsi tidak ditemukan');
  if (rows.some((row) => row.queueStatus !== 'OPEN')) {
    throw new QueueControlError('Konsumsi sudah masuk cutoff dan tidak bisa dibatalkan');
  }
  if (rows.some((row) => !Number.isInteger(row.qty) || row.qty <= 0)) {
    throw new QueueControlError('Qty konsumsi yang akan dibalik tidak valid');
  }
  return rows.map((row) => ({
    consumptionId: row.consumptionId,
    queueDeltaPcs: -row.qty,
    stockDeltaPcs: row.qty,
  }));
}
