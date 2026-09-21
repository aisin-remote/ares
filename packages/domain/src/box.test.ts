import { describe, it, expect } from 'vitest';
import { pcsToBoxes, planPicklist, type QueueInput } from './box';

describe('pcsToBoxes (6.1.1–6.1.2)', () => {
  it('floor: sisa menjadi carry-over', () => {
    expect(pcsToBoxes(250, 100)).toEqual({ boxes: 2, carryOverPcs: 50 });
  });

  it('floor: pas habis → carry-over 0', () => {
    expect(pcsToBoxes(300, 100)).toEqual({ boxes: 3, carryOverPcs: 0 });
  });

  it('floor: kurang dari satu box → 0 box, semua jadi carry-over (6.1.3)', () => {
    expect(pcsToBoxes(99, 100)).toEqual({ boxes: 0, carryOverPcs: 99 });
  });

  it('ceil: dibulatkan ke atas, carry-over selalu 0 (F-07)', () => {
    expect(pcsToBoxes(250, 100, 'CEIL')).toEqual({ boxes: 3, carryOverPcs: 0 });
    expect(pcsToBoxes(300, 100, 'CEIL')).toEqual({ boxes: 3, carryOverPcs: 0 });
  });

  it('antrean nol atau negatif (koreksi PPIC) → 0 box, nilai terbawa apa adanya', () => {
    expect(pcsToBoxes(0, 100)).toEqual({ boxes: 0, carryOverPcs: 0 });
    expect(pcsToBoxes(-30, 100)).toEqual({ boxes: 0, carryOverPcs: -30 });
    expect(pcsToBoxes(-30, 100, 'CEIL')).toEqual({ boxes: 0, carryOverPcs: -30 });
  });

  it('qty per box tidak sah → galat, bukan pembagian nol diam-diam', () => {
    expect(() => pcsToBoxes(100, 0)).toThrow();
    expect(() => pcsToBoxes(100, -5)).toThrow();
    expect(() => pcsToBoxes(100, 2.5)).toThrow();
  });
});

describe('planPicklist (6.1)', () => {
  const items: QueueInput[] = [
    { vendorPartId: 1, queuePcs: 230, carryOverPcs: 20, qtyPerBox: 100 }, // 250 → 2 box, sisa 50
    { vendorPartId: 2, queuePcs: 40, carryOverPcs: 10, qtyPerBox: 100 }, // 50 → 0 box
    { vendorPartId: 3, queuePcs: 500, carryOverPcs: 0, qtyPerBox: 50, hold: true },
  ];

  it('total = antrean + carry-over (6.1.1)', () => {
    const [a] = planPicklist(items);
    expect(a).toEqual({ vendorPartId: 1, boxes: 2, pcs: 200, carryOverPcs: 50, held: false });
  });

  it('box 0 tidak masuk picklist tapi carry-over tetap tersimpan (6.1.3)', () => {
    const b = planPicklist(items)[1]!;
    expect(b.boxes).toBe(0);
    expect(b.carryOverPcs).toBe(50);
    expect(planPicklist(items).filter((r) => r.boxes > 0).map((r) => r.vendorPartId)).toEqual([1]);
  });

  it('hold dilewati, antreannya tidak disentuh (6.1.4)', () => {
    const c = planPicklist(items)[2]!;
    expect(c).toEqual({ vendorPartId: 3, boxes: 0, pcs: 0, carryOverPcs: 0, held: true });
  });

  it('pembulatan berlaku untuk seluruh supplier (F-07)', () => {
    const out = planPicklist(items, 'CEIL');
    expect(out[0]).toMatchObject({ boxes: 3, pcs: 300, carryOverPcs: 0 });
    expect(out[1]).toMatchObject({ boxes: 1, pcs: 100, carryOverPcs: 0 });
    expect(out[2]!.held).toBe(true);
  });

  it('satu supplier satu cutoff → satu daftar, urutan input dipertahankan (6.1.5)', () => {
    expect(planPicklist(items).map((r) => r.vendorPartId)).toEqual([1, 2, 3]);
    expect(planPicklist([])).toEqual([]);
  });
});
