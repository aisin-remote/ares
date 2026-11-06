import { describe, expect, it } from 'vitest';
import { addMonths, normalizeSapPo, poPullTarget, samePoUnit, sapPoMonth, type SapPoRow } from './sap-po';

const row: SapPoRow = {
  poNo: '4100000002 ', vendorNo: '0000100231 ', createdDate: '20261022', status: '9 ',
  headerDeleted: '0 ', closed: ' ', error: ' ', item: 10, material: '00001234 ',
  quantity: '10.000 ', uom: 'PC ', plant: '700 ', lineDeleted: ' ',
};

describe('pemetaan PO bulanan staging SAP', () => {
  it('PO dibuat Oktober berlaku November, nol depan dan qty PO dipertahankan', () => {
    expect(normalizeSapPo(row)).toEqual({
      poNo: '4100000002', vendorNo: '0000100231', material: '00001234', item: '00010',
      orderedQty: 10, uom: 'PC', plant: '700', inactive: false,
      validFrom: '2026-11-01', validTo: '2026-11-30',
    });
    expect(normalizeSapPo({ ...row, createdDate: '20261205' })).toMatchObject({
      validFrom: '2027-01-01', validTo: '2027-01-31',
    });
  });
  it('menolak format/tanggal dan qty ambigu tanpa menebak atau membulatkan', () => {
    for (const quantity of ['1,000', '-1', '10.500', '', 'Infinity', '2147483648']) {
      expect(() => normalizeSapPo({ ...row, quantity })).toThrow();
    }
    expect(() => normalizeSapPo({ ...row, createdDate: '20260230' })).toThrow();
    expect(() => normalizeSapPo({ ...row, item: null })).toThrow();
  });
  it('menandai PO atau item yang ditutup/dihapus/error tidak aktif', () => {
    for (const field of ['headerDeleted', 'closed', 'error', 'lineDeleted']) {
      expect(normalizeSapPo({ ...row, [field]: 'X' }).inactive).toBe(true);
    }
  });
  it('memakai bulan WIB saat UTC masih bulan sebelumnya dan tidak menyamakan UOM berbeda', () => {
    expect(sapPoMonth(new Date('2026-10-31T17:00:00Z'))).toBe('2026-11');
    expect(samePoUnit('PC ', 'pcs')).toBe(true);
    expect(samePoUnit('KG', 'PC')).toBe(false);
  });
});

describe('jadwal tarik PO (F-44)', () => {
  it('hanya pada tanggal tarik WIB, untuk bulan berikutnya', () => {
    expect(poPullTarget(new Date('2026-10-24T01:00:00Z'), 24)).toBe('2026-11');
    // 23 Okt 17:30 UTC = 24 Okt 00:30 WIB
    expect(poPullTarget(new Date('2026-10-23T17:30:00Z'), 24)).toBe('2026-11');
    expect(poPullTarget(new Date('2026-10-23T10:00:00Z'), 24)).toBeNull();
    expect(poPullTarget(new Date('2026-12-20T03:00:00Z'), 20)).toBe('2027-01');
    expect(() => poPullTarget(new Date(), 29)).toThrow();
  });
  it('addMonths melintasi tahun', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2027-01', -1)).toBe('2026-12');
  });
});
