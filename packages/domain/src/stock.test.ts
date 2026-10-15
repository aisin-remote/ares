import { describe, expect, it } from 'vitest';
import { combineStock, pendingSnapshotDates } from './stock';

describe('combineStock', () => {
  it('menjumlahkan saldo beku dengan mutasi sesudahnya', () => {
    const hasil = combineStock(
      { balancePcs: 1200, mutationCount: 40, lastAt: new Date('2026-09-25T02:00:00Z') },
      { deltaPcs: -300, mutationCount: 3, lastAt: new Date('2026-09-26T01:00:00Z') },
    );
    expect(hasil).toEqual({
      pcs: 900,
      mutations: 43,
      lastAt: new Date('2026-09-26T01:00:00Z'),
    });
  });

  it('part yang belum pernah dibekukan memakai mutasinya saja', () => {
    const hasil = combineStock(null, {
      deltaPcs: 60,
      mutationCount: 2,
      lastAt: new Date('2026-09-26T03:00:00Z'),
    });
    expect(hasil.pcs).toBe(60);
    expect(hasil.mutations).toBe(2);
  });

  it('part yang hari ini diam memakai snapshot-nya saja', () => {
    const beku = { balancePcs: 500, mutationCount: 9, lastAt: new Date('2026-09-20T05:00:00Z') };
    expect(combineStock(beku, null)).toEqual({
      pcs: 500,
      mutations: 9,
      lastAt: new Date('2026-09-20T05:00:00Z'),
    });
  });

  it('saldo boleh negatif — konsumsi bisa tercatat sebelum penerimaannya', () => {
    expect(combineStock({ balancePcs: 10, mutationCount: 1, lastAt: null }, {
      deltaPcs: -25,
      mutationCount: 1,
      lastAt: null,
    }).pcs).toBe(-15);
  });

  it('tanpa snapshot dan tanpa mutasi hasilnya nol, bukan NaN', () => {
    expect(combineStock(null, null)).toEqual({ pcs: 0, mutations: 0, lastAt: null });
  });
});

describe('pendingSnapshotDates', () => {
  it('membekukan hari-hari yang terlewat, tidak termasuk hari berjalan', () => {
    expect(
      pendingSnapshotDates({ lastAsOf: '2026-09-23', earliest: '2026-01-01', today: '2026-09-26' }),
    ).toEqual(['2026-09-24', '2026-09-25', '2026-09-26']);
  });

  it('snapshot pertama sehari setelah mutasi pertama, karena AS_OF eksklusif', () => {
    expect(
      pendingSnapshotDates({ lastAsOf: null, earliest: '2026-09-24', today: '2026-09-26' }),
    ).toEqual(['2026-09-25', '2026-09-26']);
  });

  it('tidak ada mutasi sama sekali → tidak ada yang dibekukan', () => {
    expect(pendingSnapshotDates({ lastAsOf: null, earliest: null, today: '2026-09-26' })).toEqual([]);
  });

  it('sudah mutakhir → kosong, job berikutnya tidak menulis apa-apa', () => {
    expect(
      pendingSnapshotDates({ lastAsOf: '2026-09-26', earliest: '2026-01-01', today: '2026-09-26' }),
    ).toEqual([]);
  });

  it('menyeberangi pergantian bulan', () => {
    expect(
      pendingSnapshotDates({ lastAsOf: '2026-02-27', earliest: '2026-01-01', today: '2026-03-02' }),
    ).toEqual(['2026-02-28', '2026-03-01', '2026-03-02']);
  });

  it('dibatasi maxDays supaya satu job tidak menulis ratusan hari', () => {
    const hasil = pendingSnapshotDates(
      { lastAsOf: '2025-01-01', earliest: '2025-01-01', today: '2026-09-26' },
      31,
    );
    expect(hasil).toHaveLength(31);
    expect(hasil[0]).toBe('2025-01-02');
  });
});
