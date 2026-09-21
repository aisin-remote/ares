import { describe, expect, it } from 'vitest';
import {
  assignCutoff,
  consumeProduction,
  MissingVendorPartError,
} from './consumption';

const record = {
  id: 'PR-001',
  parentPartId: 10,
  qty: 2,
  line: 'L3',
  occurredAt: new Date('2026-09-21T01:30:00.000Z'),
};

describe('consumeProduction (PRD 6.7.1)', () => {
  it('mengurai BOM yang berlaku dan memilih vendor part aktif untuk setiap komponen daun', () => {
    const out = consumeProduction(
      record,
      [
        { parentPartId: 10, componentPartId: 20, qtyPer: 2, effectiveFrom: '2026-01-01' },
        { parentPartId: 10, componentPartId: 30, qtyPer: 3, effectiveFrom: '2026-01-01' },
        { parentPartId: 10, componentPartId: 40, qtyPer: 9, effectiveFrom: '2025-01-01', effectiveTo: '2025-12-31' },
      ],
      [
        { id: 200, partId: 20, isActive: true },
        { id: 300, partId: 30, isActive: true },
        { id: 400, partId: 40, isActive: true },
      ],
    );

    expect(out).toEqual([
      { sourceKey: 'MES:PR-001', parentPartId: 10, componentPartId: 20,
        vendorPartId: 200, qty: 4, line: 'L3', occurredAt: record.occurredAt },
      { sourceKey: 'MES:PR-001:30', parentPartId: 10, componentPartId: 30,
        vendorPartId: 300, qty: 6, line: 'L3', occurredAt: record.occurredAt },
    ]);
  });

  it('menjumlahkan komponen daun yang muncul di beberapa cabang BOM', () => {
    const out = consumeProduction(
      { ...record, qty: 5 },
      [
        { parentPartId: 10, componentPartId: 20, qtyPer: 1, effectiveFrom: '2026-01-01' },
        { parentPartId: 10, componentPartId: 30, qtyPer: 2, effectiveFrom: '2026-01-01' },
        { parentPartId: 20, componentPartId: 40, qtyPer: 0.5, effectiveFrom: '2026-01-01' },
        { parentPartId: 30, componentPartId: 40, qtyPer: 0.25, effectiveFrom: '2026-01-01' },
      ],
      [{ id: 400, partId: 40, isActive: true }],
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ componentPartId: 40, vendorPartId: 400, qty: 5 });
  });

  it('menolak seluruh record bila komponen tidak punya vendor part aktif', () => {
    expect(() => consumeProduction(
      record,
      [{ parentPartId: 10, componentPartId: 20, qtyPer: 1, effectiveFrom: '2026-01-01' }],
      [{ id: 200, partId: 20, isActive: false }],
    )).toThrow(MissingVendorPartError);
  });
});

describe('assignCutoff (PRD 6.2.5, F-14)', () => {
  const base = {
    workdays: '1,2,3,4,5',
    leadDays: 1,
    arrivalTime: '08:00:00',
    holidayShift: 'AFTER' as const,
  };

  it('memilih cutoff efektif paling awal dari beberapa jadwal supplier', () => {
    const out = assignCutoff(
      new Date('2026-09-21T02:00:00.000Z'), // Senin 09:00 WIB
      [
        { id: 1, cutoffTime: '10:00:00', ...base },
        { id: 2, cutoffTime: '15:00:00', ...base },
      ],
      [],
    );
    expect(out?.cutoffId).toBe(1);
    expect(out?.cutoffAt.toISOString()).toBe('2026-09-21T03:00:00.000Z');
  });

  it('tepat pada detik cutoff masuk jadwal berikutnya', () => {
    const out = assignCutoff(
      new Date('2026-09-21T03:00:00.000Z'), // tepat 10:00 WIB
      [
        { id: 1, cutoffTime: '10:00:00', ...base },
        { id: 2, cutoffTime: '15:00:00', ...base },
      ],
      [],
    );
    expect(out?.cutoffId).toBe(2);
    expect(out?.cutoffAt.toISOString()).toBe('2026-09-21T08:00:00.000Z');
  });
});
