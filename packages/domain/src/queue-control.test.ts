import { describe, expect, it } from 'vitest';
import {
  applyQueueAdjustment,
  planConsumptionReversal,
  QueueControlError,
  setQueueKanbanQuantity,
} from './queue-control';

describe('applyQueueAdjustment (F-13)', () => {
  it('menambah dan mengurangi pcs tanpa membuat antrean negatif', () => {
    expect(applyQueueAdjustment(120, 30)).toBe(150);
    expect(applyQueueAdjustment(120, -20)).toBe(100);
    expect(() => applyQueueAdjustment(10, -11)).toThrow(QueueControlError);
  });

  it('hanya menerima bilangan bulat dan delta bukan nol', () => {
    expect(() => applyQueueAdjustment(10, 0)).toThrow(QueueControlError);
    expect(() => applyQueueAdjustment(10, 1.5)).toThrow(QueueControlError);
  });
});

describe('setQueueKanbanQuantity (F-13)', () => {
  it('mengubah jumlah kanban menjadi PCS sambil mempertahankan carry over yang masih terpakai', () => {
    expect(setQueueKanbanQuantity({
      queuePcs: 0,
      carryOverPcs: 6,
      qtyPerKanban: 24,
      kanban: 1,
    })).toEqual({
      kanban: 1,
      totalPcs: 24,
      pcs: 18,
      carryOverPcs: 6,
      deltaPcs: 18,
    });
  });

  it('bisa menurunkan order sampai nol dan menolak jumlah yang tidak berubah', () => {
    expect(setQueueKanbanQuantity({
      queuePcs: 0,
      carryOverPcs: 6,
      qtyPerKanban: 24,
      kanban: 0,
    })).toMatchObject({ pcs: 0, carryOverPcs: 0, deltaPcs: -6 });
    expect(() => setQueueKanbanQuantity({
      queuePcs: 18,
      carryOverPcs: 6,
      qtyPerKanban: 24,
      kanban: 1,
    })).toThrow(QueueControlError);
  });
});

describe('planConsumptionReversal (F-15)', () => {
  it('membalik konsumsi menjadi pengurangan antrean dan penambahan stok', () => {
    expect(planConsumptionReversal([
      { consumptionId: 11, qty: 5, queueStatus: 'OPEN' },
      { consumptionId: 12, qty: 10, queueStatus: 'OPEN' },
    ])).toEqual([
      { consumptionId: 11, queueDeltaPcs: -5, stockDeltaPcs: 5 },
      { consumptionId: 12, queueDeltaPcs: -10, stockDeltaPcs: 10 },
    ]);
  });

  it('menolak record yang sudah masuk cutoff CLOSED', () => {
    expect(() => planConsumptionReversal([
      { consumptionId: 11, qty: 5, queueStatus: 'CLOSED' },
    ])).toThrow(QueueControlError);
  });
});
