import { describe, it, expect } from 'vitest';
import {
  pickPoItem,
  canTransition,
  assertTransition,
  cycleOfCutoff,
  type PoCandidate,
} from './picklist';

describe('pickPoItem (6.6.1, F-18)', () => {
  const po = (over: Partial<PoCandidate>): PoCandidate => ({
    poLineId: 1,
    sapPoNo: '4500000001',
    sapPoItem: '00010',
    partId: 7,
    openQty: 1000,
    validFrom: '2026-01-01',
    validTo: '2026-12-31',
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

  it('validFrom/validTo kosong berarti tidak dibatasi', () => {
    expect(pickPoItem([po({ validFrom: null, validTo: null })], 7, '2099-01-01')?.poLineId).toBe(1);
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

  it('tanpa default: yang paling cepat berakhir dipakai dulu, lalu urut nomor PO', () => {
    const c = [
      po({ poLineId: 1, sapPoNo: '4500000009', validTo: null }),
      po({ poLineId: 2, sapPoNo: '4500000002', validTo: '2026-10-31' }),
      po({ poLineId: 3, sapPoNo: '4500000001', validTo: '2026-10-31' }),
    ];
    expect(pickPoItem(c, 7, '2026-09-20')?.poLineId).toBe(3);
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

describe('cycleOfCutoff (§14)', () => {
  const jadwal = [
    { id: 8, cutoffTime: '15:00:00', arrivalTime: '08:00:00' },
    { id: 3, cutoffTime: '10:00:00', arrivalTime: '14:00:00' },
    { id: 5, cutoffTime: '21:30:00', arrivalTime: '20:00:00' },
  ];

  it('truk yang datang paling pagi adalah cycle 1', () => {
    expect(cycleOfCutoff(jadwal, 8)).toBe(1);
    expect(cycleOfCutoff(jadwal, 3)).toBe(2);
    expect(cycleOfCutoff(jadwal, 5)).toBe(3);
  });

  it('urutan kedatangan menang atas urutan cutoff, bukan sebaliknya', () => {
    // Data seed repo ini persis kasusnya: cutoff 10:00 tiba 14:00, cutoff
    // 15:00 tiba 08:00 keesokan harinya. Mengurutkan jam cutoff membuat truk
    // pertama hari itu membawa kartu bertuliskan cycle 2.
    const terbalik = [
      { id: 1, cutoffTime: '10:00:00', arrivalTime: '14:00:00' },
      { id: 2, cutoffTime: '15:00:00', arrivalTime: '08:00:00' },
    ];
    expect(cycleOfCutoff(terbalik, 2)).toBe(1);
    expect(cycleOfCutoff(terbalik, 1)).toBe(2);
  });

  it('jam kedatangan sama diurutkan dengan cutoff lalu id, supaya stabil', () => {
    const kembar = [
      { id: 9, cutoffTime: '11:00:00', arrivalTime: '10:00:00' },
      { id: 4, cutoffTime: '06:00:00', arrivalTime: '10:00:00' },
    ];
    expect(cycleOfCutoff(kembar, 4)).toBe(1);
    expect(cycleOfCutoff(kembar, 9)).toBe(2);
  });

  it('cutoff di luar daftar → null, bukan menebak cycle 1', () => {
    expect(cycleOfCutoff(jadwal, 99)).toBeNull();
    expect(cycleOfCutoff([], 3)).toBeNull();
  });
});
