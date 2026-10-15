import { describe, expect, it } from 'vitest';
import { validateGrForSap } from './sap';

const valid = {
  plant: 'BODY',
  vendorNo: 'J901',
  items: [
    {
      poNo: '4500000123',
      poItem: '00010',
      material: '423175-10610',
      qty: 80,
      uom: 'PC',
      poMatchesVendor: true,
      poMatchesPart: true,
      poOpenQty: 100,
    },
  ],
};

describe('validasi GR sebelum SAP', () => {
  it('menerima GR yang lengkap dan masih berada dalam open quantity PO', () => {
    expect(validateGrForSap(valid)).toEqual([]);
  });

  it('menjelaskan seluruh data yang membuat GR harus ditahan', () => {
    expect(
      validateGrForSap({
        plant: '',
        vendorNo: null,
        items: [
          {
            poNo: '',
            poItem: '',
            material: '',
            qty: 0,
            uom: '',
            poMatchesVendor: false,
            poMatchesPart: false,
            poOpenQty: 0,
          },
        ],
      }),
    ).toEqual([
      'Kode plant belum tersedia',
      'Nomor SAP supplier belum tersedia',
      'Baris 1: nomor PO belum tersedia',
      'Baris 1: item PO belum tersedia',
      'Baris 1: material SAP belum tersedia',
      'Baris 1: quantity harus lebih dari 0',
      'Baris 1: UOM belum tersedia',
      'Baris 1: PO tidak aktif untuk supplier ini',
      'Baris 1: item PO tidak sesuai dengan part',
    ]);
  });

  it('menolak quantity yang melebihi sisa PO', () => {
    expect(
      validateGrForSap({
        ...valid,
        items: [{ ...valid.items[0]!, qty: 101 }],
      }),
    ).toEqual(['Baris 1: quantity 101 melebihi sisa PO 100']);
  });

  it('menolak receipt tanpa barang', () => {
    expect(validateGrForSap({ ...valid, items: [] })).toEqual([
      'Receipt tidak memiliki barang yang diterima',
    ]);
  });
});
