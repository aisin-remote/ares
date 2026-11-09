import { describe, expect, it } from 'vitest';
import { ClaimError, planClaim, receiveClaim } from './claim';

const source = [
  { picklistLineId: 1, qtyPerBox: 50, boxReceived: 4, boxClaimed: 0 },
  { picklistLineId: 2, qtyPerBox: 20, boxReceived: 3, boxClaimed: 1 },
];

describe('planClaim', () => {
  it('menghitung pcs dari box rusak dan membuang line tanpa qty', () => {
    expect(planClaim(source, [
      { picklistLineId: 1, damagedBox: 2 },
      { picklistLineId: 2, damagedBox: 0 },
    ])).toEqual([{ picklistLineId: 1, boxOrdered: 2, pcs: 100 }]);
  });

  it('menolak box rusak melebihi sisa yang bisa diklaim', () => {
    expect(() => planClaim(source, [{ picklistLineId: 2, damagedBox: 3 }])).toThrow(ClaimError);
    expect(planClaim(source, [{ picklistLineId: 2, damagedBox: 2 }])[0]).toEqual({
      picklistLineId: 2,
      boxOrdered: 2,
      pcs: 40,
    });
  });

  it('menolak line asing, line ganda, dan claim kosong', () => {
    expect(() => planClaim(source, [{ picklistLineId: 9, damagedBox: 1 }])).toThrow(ClaimError);
    expect(() => planClaim(source, [
      { picklistLineId: 1, damagedBox: 1 },
      { picklistLineId: 1, damagedBox: 1 },
    ])).toThrow(ClaimError);
    expect(() => planClaim(source, [{ picklistLineId: 1, damagedBox: 0 }])).toThrow(ClaimError);
  });
});

describe('receiveClaim', () => {
  const lines = [{ picklistLineId: 1, boxOrdered: 2, boxReceived: 0, qtyPerBox: 50 }];

  it('menandai lengkap saat semua box claim datang', () => {
    expect(receiveClaim(lines, new Map([[1, 2]]))).toEqual({
      lines: [{ picklistLineId: 1, boxReceived: 2, pcsReceived: 100, complete: true }],
      complete: true,
    });
  });

  it('menerima sebagian dan belum menutup claim', () => {
    const hasil = receiveClaim(lines, new Map([[1, 1]]));
    expect(hasil.complete).toBe(false);
    expect(hasil.lines[0]).toMatchObject({ boxReceived: 1, pcsReceived: 50 });
  });

  it('menolak melebihi box claim dan penerimaan kosong', () => {
    expect(() => receiveClaim(lines, new Map([[1, 3]]))).toThrow(ClaimError);
    expect(() => receiveClaim(lines, new Map([[1, 0]]))).toThrow(ClaimError);
  });
});
