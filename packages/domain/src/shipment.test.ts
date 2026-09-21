import { describe, it, expect } from 'vitest';
import { confirmShipment, ShipmentError, type ShipmentLineInput } from './shipment';

const k = (
  id: string,
  serial: number,
  status: 'PRINTED' | 'RECEIVED' | 'CANCELLED' = 'PRINTED',
) => ({
  id,
  serial,
  status,
});

const LINE_A: ShipmentLineInput = {
  picklistLineId: 1,
  boxOrdered: 3,
  boxShipped: 3,
  kanbans: [k('a1', 1), k('a2', 2), k('a3', 3)],
};
const LINE_B: ShipmentLineInput = {
  picklistLineId: 2,
  boxOrdered: 2,
  boxShipped: 2,
  kanbans: [k('b1', 4), k('b2', 5)],
};

describe('confirmShipment (6.3.1) — validasi', () => {
  it('box dikirim tidak boleh melebihi box diorder', () => {
    expect(() => confirmShipment([{ ...LINE_A, boxShipped: 4 }], 'CARRY_OVER')).toThrow(
      ShipmentError,
    );
  });

  it('box dikirim harus bilangan bulat ≥ 0', () => {
    expect(() => confirmShipment([{ ...LINE_A, boxShipped: -1 }], 'CARRY_OVER')).toThrow(
      ShipmentError,
    );
    expect(() => confirmShipment([{ ...LINE_A, boxShipped: 1.5 }], 'CARRY_OVER')).toThrow(
      ShipmentError,
    );
  });

  it('konfirmasi tanpa satu pun box bukan pengiriman', () => {
    expect(() =>
      confirmShipment(
        [
          { ...LINE_A, boxShipped: 0 },
          { ...LINE_B, boxShipped: 0 },
        ],
        'REVISION',
      ),
    ).toThrow(ShipmentError);
  });

  it('pesan galat menyebut line yang salah', () => {
    expect(() => confirmShipment([LINE_A, { ...LINE_B, boxShipped: 5 }], 'CARRY_OVER')).toThrow(
      /line 2/,
    );
  });
});

describe('confirmShipment — penuh', () => {
  it('semua line OPEN, semua kanban dikirim, tidak ada sisa', () => {
    const out = confirmShipment([LINE_A, LINE_B], 'CARRY_OVER');
    expect(out.short).toBe(false);
    expect(out.cancelledKanbanIds).toEqual([]);
    expect(out.revisionLines).toEqual([]);
    expect(out.lines).toEqual([
      {
        picklistLineId: 1,
        boxShipped: 3,
        boxShort: 0,
        status: 'OPEN',
        shippedKanbanIds: ['a1', 'a2', 'a3'],
        shortKanbanIds: [],
      },
      {
        picklistLineId: 2,
        boxShipped: 2,
        boxShort: 0,
        status: 'OPEN',
        shippedKanbanIds: ['b1', 'b2'],
        shortKanbanIds: [],
      },
    ]);
  });

  it('kanban yang dikirim diambil dari serial terkecil, sisanya serial terbesar', () => {
    const out = confirmShipment(
      [{ ...LINE_A, boxShipped: 1, kanbans: [k('a3', 3), k('a1', 1), k('a2', 2)] }],
      'CARRY_OVER',
    );
    expect(out.lines[0]!.shippedKanbanIds).toEqual(['a1']);
    expect(out.lines[0]!.shortKanbanIds).toEqual(['a2', 'a3']);
  });
});

describe('confirmShipment — kurang, kebijakan CARRY_OVER (6.3.2)', () => {
  it('line kurang jadi SHORT, kanban sisa CANCELLED, tidak ada revisi', () => {
    const out = confirmShipment([{ ...LINE_A, boxShipped: 1 }, LINE_B], 'CARRY_OVER');
    expect(out.short).toBe(true);
    expect(out.lines[0]).toMatchObject({
      boxShipped: 1,
      boxShort: 2,
      status: 'SHORT',
      shippedKanbanIds: ['a1'],
      shortKanbanIds: ['a2', 'a3'],
    });
    expect(out.lines[1]!.status).toBe('OPEN');
    expect(out.cancelledKanbanIds).toEqual(['a2', 'a3']);
    expect(out.revisionLines).toEqual([]);
  });

  it('pcs yang harus kembali ke antrean = sisa × qty per box (dihitung pemanggil dari boxShort)', () => {
    const out = confirmShipment([{ ...LINE_A, boxShipped: 0 }, LINE_B], 'CARRY_OVER');
    expect(out.lines[0]!.boxShort).toBe(3);
  });
});

describe('confirmShipment — kurang, kebijakan REVISION (6.3.3, F-25)', () => {
  it('sisa menjadi line revisi; kanban sisa tetap PRINTED dan ikut ke revisi', () => {
    const out = confirmShipment(
      [
        { ...LINE_A, boxShipped: 1 },
        { ...LINE_B, boxShipped: 2 },
      ],
      'REVISION',
    );
    expect(out.short).toBe(true);
    expect(out.cancelledKanbanIds).toEqual([]);
    expect(out.revisionLines).toEqual([{ picklistLineId: 1, boxes: 2, kanbanIds: ['a2', 'a3'] }]);
    expect(out.lines[0]!.status).toBe('SHORT');
  });

  it('line yang penuh tidak ikut ke revisi (hanya yang belum terkirim)', () => {
    const out = confirmShipment([LINE_A, { ...LINE_B, boxShipped: 0 }], 'REVISION');
    expect(out.revisionLines.map((r) => r.picklistLineId)).toEqual([2]);
  });
});

describe('confirmShipment — kanban yang sudah diterima sebelum konfirmasi', () => {
  // Catatan 6.4: kanban PRINTED boleh diterima duluan; saat supplier akhirnya
  // mengonfirmasi, box itu sudah terhitung terkirim.
  it('kanban RECEIVED dihitung sebagai bagian box dikirim, tidak dikirim ulang', () => {
    const out = confirmShipment(
      [{ ...LINE_A, boxShipped: 2, kanbans: [k('a1', 1, 'RECEIVED'), k('a2', 2), k('a3', 3)] }],
      'CARRY_OVER',
    );
    expect(out.lines[0]).toMatchObject({
      shippedKanbanIds: ['a2'],
      shortKanbanIds: ['a3'],
      boxShort: 1,
    });
  });

  it('box dikirim tidak boleh kurang dari yang sudah diterima', () => {
    expect(() =>
      confirmShipment(
        [{ ...LINE_A, boxShipped: 0, kanbans: [k('a1', 1, 'RECEIVED'), k('a2', 2), k('a3', 3)] }],
        'CARRY_OVER',
      ),
    ).toThrow(ShipmentError);
  });

  it('kanban CANCELLED diabaikan', () => {
    const out = confirmShipment(
      [
        {
          ...LINE_A,
          boxOrdered: 2,
          boxShipped: 2,
          kanbans: [k('a1', 1), k('a2', 2), k('a3', 3, 'CANCELLED')],
        },
      ],
      'CARRY_OVER',
    );
    expect(out.lines[0]!.shippedKanbanIds).toEqual(['a1', 'a2']);
  });
});
