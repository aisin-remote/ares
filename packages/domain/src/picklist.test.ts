import { describe, it, expect } from 'vitest';
import {
  pickPoItem,
  pickRecoveryPoItem,
  poPeriodForDate,
  checkPoOpenQty,
  canTransition,
  assertTransition,
  type PoCandidate,
} from './picklist';

describe('checkPoOpenQty (F-19)', () => {
  it('mengizinkan jumlah tepat sampai open qty', () => {
    expect(checkPoOpenQty({ openQty: 1_000, orderedPcs: 700, newPcs: 300 })).toEqual({
      allowed: true,
      reason: null,
      availablePcs: 300,
      projectedPcs: 1_000,
    });
  });

  it('memblokir jumlah yang membuat total pesanan melebihi qty PO', () => {
    expect(checkPoOpenQty({ openQty: 1_000, orderedPcs: 700, newPcs: 301 })).toEqual({
      allowed: false,
      reason: 'PO_OPEN_QTY',
      availablePcs: 300,
      projectedPcs: 1_001,
    });
  });

  it('sisa PO tidak pernah negatif walau pesanan lama melebihi qty PO hasil tarik ulang', () => {
    expect(checkPoOpenQty({ openQty: 1_000, orderedPcs: 1_200, newPcs: 0 })).toMatchObject({
      allowed: false, availablePcs: 0,
    });
  });
});

describe('pickPoItem (6.6.1, F-18)', () => {
  const po = (over: Partial<PoCandidate>): PoCandidate => ({
    poLineId: 1,
    sapPoNo: '4500000001',
    sapPoItem: '00010',
    partId: 7,
    openQty: 1000,
    validFrom: '2026-09-01',
    validTo: '2026-09-30',
    ...over,
  });

  it('memilih PO item part itu yang berlaku pada tanggal kirim', () => {
    const c = [po({ poLineId: 1, partId: 7 }), po({ poLineId: 2, partId: 8 })];
    expect(pickPoItem(c, 7, '2026-09-20')?.poLineId).toBe(1);
  });

  it('part tanpa PO item aktif → null (line tidak terbit)', () => {
    expect(pickPoItem([po({ partId: 8 })], 7, '2026-09-20')).toBeNull();
    expect(pickPoItem([], 7, '2026-09-20')).toBeNull();
  });

  it('masa berlaku dicek terhadap tanggal kirim, bukan hari ini', () => {
    const c = [po({ validFrom: '2026-10-01', validTo: '2026-10-31' })];
    expect(pickPoItem(c, 7, '2026-09-30')).toBeNull();
    expect(pickPoItem(c, 7, '2026-10-01')?.poLineId).toBe(1);
    expect(pickPoItem(c, 7, '2026-10-31')?.poLineId).toBe(1);
    expect(pickPoItem(c, 7, '2026-11-01')).toBeNull();
  });

  it('periode kosong atau lintas bulan ditolak, bukan PO tanpa kedaluwarsa', () => {
    for (const period of [
      { validFrom: null, validTo: null },
      { validFrom: '2026-01-01', validTo: '2026-12-31' },
      { validFrom: '2026-09-01', validTo: null },
    ]) expect(pickPoItem([po(period)], 7, '2026-09-20')).toBeNull();
  });

  it('PO yang sudah habis (open qty 0) tidak dipakai (6.6.4)', () => {
    expect(pickPoItem([po({ openQty: 0 })], 7, '2026-09-20')).toBeNull();
  });

  it('PO item default vendor part didahulukan bila masih berlaku (F-02)', () => {
    const c = [po({ poLineId: 1 }), po({ poLineId: 2, sapPoNo: '4500000002' })];
    expect(pickPoItem(c, 7, '2026-09-20', 2)?.poLineId).toBe(2);
  });

  it('default yang sudah tidak berlaku diabaikan, jatuh ke kandidat lain', () => {
    const c = [po({ poLineId: 1 }), po({ poLineId: 2, validTo: '2026-06-30' })];
    expect(pickPoItem(c, 7, '2026-09-20', 2)?.poLineId).toBe(1);
  });

  it('tanpa default: hanya PO bulan pengiriman, lalu urut nomor PO', () => {
    const c = [
      po({ poLineId: 1, sapPoNo: '4500000009', validTo: null }),
      po({ poLineId: 2, sapPoNo: '4500000002' }),
      po({ poLineId: 3, sapPoNo: '4500000001' }),
    ];
    expect(pickPoItem(c, 7, '2026-09-20')?.poLineId).toBe(3);
  });

  it('recovery mempertahankan PO bulan yang sama, lalu menggantinya saat lintas bulan/tahun', () => {
    const old = po({ validFrom: '2026-12-01', validTo: '2026-12-31' });
    const next = po({ poLineId: 2, sapPoNo: '4500000002', validFrom: '2027-01-01', validTo: '2027-01-31' });
    expect(pickRecoveryPoItem([old, next], 7, '2026-12-31', old)).toEqual(old);
    expect(pickRecoveryPoItem([old, next], 7, '2027-01-01', old)).toEqual(next);
    expect(pickRecoveryPoItem([old], 7, '2027-01-01', old)).toBeNull();
    expect(pickRecoveryPoItem([old, { ...next, openQty: 0 }], 7, '2027-01-01', old)).toBeNull();
  });

  it('periode bulanan mencakup akhir Februari, tahun kabisat, dan pergantian tahun', () => {
    expect(poPeriodForDate('2028-02-29')).toEqual({ validFrom: '2028-02-01', validTo: '2028-02-29' });
    expect(poPeriodForDate('2026-02-01').validTo).toBe('2026-02-28');
    expect(poPeriodForDate('2026-12-31').validTo).toBe('2026-12-31');
    expect(() => poPeriodForDate('2026-02-29')).toThrow();
  });
});

describe('transisi status picklist & kanban (PRD §3)', () => {
  it('picklist: ISSUED/DOWNLOADED boleh dibatalkan, SHIPPED tidak (F-20, 6.6.3)', () => {
    expect(canTransition('picklist', 'ISSUED', 'CANCELLED')).toBe(true);
    expect(canTransition('picklist', 'DOWNLOADED', 'CANCELLED')).toBe(true);
    expect(canTransition('picklist', 'SHIPPED', 'CANCELLED')).toBe(false);
    expect(canTransition('picklist', 'COMPLETE', 'CANCELLED')).toBe(false);
  });

  it('picklist: alur normal', () => {
    expect(canTransition('picklist', 'ISSUED', 'DOWNLOADED')).toBe(true);
    expect(canTransition('picklist', 'DOWNLOADED', 'SHIPPED')).toBe(true);
    expect(canTransition('picklist', 'SHIPPED', 'PARTIAL')).toBe(true);
    expect(canTransition('picklist', 'SHIPPED', 'COMPLETE')).toBe(true);
    expect(canTransition('picklist', 'PARTIAL', 'COMPLETE')).toBe(true);
    expect(canTransition('picklist', 'ISSUED', 'SHIPPED')).toBe(false);
  });

  it('kanban: sekali pakai, RECEIVED adalah akhir', () => {
    expect(canTransition('kanban', 'PRINTED', 'CANCELLED')).toBe(true);
    expect(canTransition('kanban', 'SHIPPED', 'RECEIVED')).toBe(true);
    expect(canTransition('kanban', 'MISSING', 'RECEIVED')).toBe(true);
    expect(canTransition('kanban', 'RECEIVED', 'SHIPPED')).toBe(false);
    expect(canTransition('kanban', 'SHIPPED', 'CANCELLED')).toBe(false);
  });

  it('assertTransition melempar dengan pesan yang bisa ditampilkan', () => {
    expect(() => assertTransition('picklist', 'SHIPPED', 'CANCELLED')).toThrow(/SHIPPED/);
    expect(() => assertTransition('picklist', 'ISSUED', 'CANCELLED')).not.toThrow();
  });
});
