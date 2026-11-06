import { describe, expect, it } from 'vitest';
import { calculateSupplierPerformance, performancePeriod, supplierPerformanceCsv } from './supplier-performance';

const now = new Date('2026-10-22T05:00:00Z');
const base = {
  id: 1, publicId: 'order-1', orderNo: 'ORDER-1', vendorId: 1, vendorName: 'Supplier A', vendorCode: 'A',
  status: 'SHIPPED', scheduledAt: new Date('2026-10-20T03:00:00Z'), createdAt: new Date('2026-10-19T03:00:00Z'),
  confirmedAt: new Date('2026-10-19T05:00:00Z'), firstScanAt: new Date('2026-10-20T03:00:00Z'),
  hasReceiving: true, autoShipped: false,
  lines: [{ partId: 1, orderedPcs: 100, orderedBoxes: 2, receivedPcs: 100, receivedBoxes: 2 }],
};

describe('performa supplier (F-50)', () => {
  it('batas tepat waktu inklusif, toleransi dinamis, dan order belum tiba tetap menurunkan persentase', () => {
    const report = calculateSupplierPerformance([
      base,
      { ...base, id: 2, firstScanAt: new Date('2026-10-20T03:15:00Z') },
      { ...base, id: 3, firstScanAt: null, hasReceiving: false },
    ], now, 15);
    expect(report.total).toMatchObject({ dueOrders: 3, onTime: 2, late: 0, notArrived: 1, arrivalSample: 3 });
    expect(report.total.onTimePercent).toBeCloseTo(66.7, 1);
    expect(calculateSupplierPerformance([{ ...base, firstScanAt: new Date('2026-10-20T03:15:00.001Z') }], now, 15).total.late).toBe(1);
  });

  it('order mendatang dan batal tidak masuk denominator performa', () => {
    const report = calculateSupplierPerformance([
      base, { ...base, id: 2, status: 'CANCELLED' },
      { ...base, id: 3, scheduledAt: new Date('2026-10-23T03:00:00Z'), firstScanAt: null },
    ], now, 0);
    expect(report.total).toMatchObject({ orders: 2, dueOrders: 1, upcoming: 1, onTime: 1, onTimePercent: 100 });
    expect(report.orders).toHaveLength(2);
  });

  it('sesi tanpa scan tidak diklaim sebagai keterlambatan; waktu konfirmasi negatif tidak dirata-ratakan', () => {
    const report = calculateSupplierPerformance([
      { ...base, firstScanAt: null, confirmedAt: new Date('2026-10-18T01:00:00Z') },
      { ...base, id: 2, confirmedAt: null, autoShipped: true },
    ], now, 0);
    expect(report.total).toMatchObject({ unknownArrival: 1, arrivalSample: 1,
      confirmationSample: 0, invalidConfirmation: 1, withoutConfirmation: 1, autoShipped: 1,
      averageConfirmationMinutes: null });
  });

  it('kelengkapan dibatasi per part; kelebihan satu part tidak menutup kekurangan part lain', () => {
    const report = calculateSupplierPerformance([{ ...base, lines: [
      { partId: 1, orderedPcs: 100, orderedBoxes: 2, receivedPcs: 150, receivedBoxes: 3 },
      { partId: 2, orderedPcs: 100, orderedBoxes: 2, receivedPcs: 50, receivedBoxes: 1 },
    ] }], now, 0);
    expect(report.total).toMatchObject({ orderedPcs: 200, receivedPcs: 200, fulfilledPcs: 150,
      shortPcs: 50, extraPcs: 50, fulfillmentPercent: 75 });
  });

  it('rata-rata total dibobot jumlah konfirmasi, bukan rata-rata antar supplier', () => {
    const report = calculateSupplierPerformance([
      base, { ...base, id: 2 },
      { ...base, id: 3, vendorId: 2, vendorName: 'Supplier B', confirmedAt: new Date('2026-10-19T09:00:00Z') },
    ], now, 0);
    expect(report.total.averageConfirmationMinutes).toBe(200);
    expect(report.orders[0]?.confirmationMinutes).toBe(120);
    expect(report.suppliers).toHaveLength(2);
    expect(calculateSupplierPerformance([], now, 0).total.onTimePercent).toBeNull();
  });

  it('periode memakai jadwal WIB dan penilaian berhenti di akhir periode atau waktu sekarang', () => {
    const period = performancePeriod({ from: '2026-09-01', to: '2026-09-30', tolerance: '15' }, now);
    expect(period.asOf.toISOString()).toBe('2026-09-30T16:59:59.999Z');
    expect(period.toleranceMinutes).toBe(15);
    expect(performancePeriod({}, now).from).toBe('2026-10-01');
    expect(performancePeriod({}, now).asOf).toEqual(now);
    expect(() => performancePeriod({ from: '2026-02-30' }, now)).toThrow();
    expect(() => performancePeriod({ from: '2025-01-01', to: '2026-10-22' }, now)).toThrow();
    expect(() => performancePeriod({ tolerance: '-1' }, now)).toThrow();
  });
  it('ekspor menyertakan definisi filter dan menetralkan formula dari nama supplier', () => {
    const report = calculateSupplierPerformance([{ ...base, vendorName: '=HYPERLINK("unsafe")' }], now, 0);
    const csv = supplierPerformanceCsv(report, performancePeriod({}, now));
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('"\'=HYPERLINK(""unsafe"")"');
    expect(csv).toContain('2026-10-01');
    expect(csv).toContain('Scan kanban valid pertama');
  });
});
