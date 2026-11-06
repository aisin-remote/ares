import { describe, expect, it } from 'vitest';
import { normalizeSapPart, normalizeSapVendor, pickSapPackaging, type SapKanbanRow } from './sap-master';

describe('normalisasi master SAP (F-01)', () => {
  it('supplier: buang padding char, flag hapus menonaktifkan', () => {
    expect(normalizeSapVendor({ supplierId: 'A10000    ', name: 'STEEL CENTER INDONESIA, PT  ', address: 'JLN. SUNTER II  ', deleted: ' ' }))
      .toEqual({ sapVendorNo: 'A10000', name: 'STEEL CENTER INDONESIA, PT', address: 'JLN. SUNTER II', isActive: true });
    expect(normalizeSapVendor({ supplierId: 'A1', name: 'X', address: '', deleted: 'X' })).toMatchObject({ address: null, isActive: false });
    expect(() => normalizeSapVendor({ supplierId: ' ', name: 'X', address: null, deleted: null })).toThrow();
  });
  it('part: nomor tampilan dari nomor berdash, material SAP tetap kunci', () => {
    expect(normalizeSapPart({
      material: '32159430500 ', name: 'SPRING CLUTCH ', uom: 'pc', partNoDash: '321594-30500 ',
      backNo: 'D160', boxType: null, qtyPerBox: 1, deleted: '',
    })).toEqual({ sapMaterialNo: '32159430500', partNo: '321594-30500', name: 'SPRING CLUTCH', uom: 'PC', isActive: true });
    expect(normalizeSapPart({ material: 'M1', name: 'N', uom: null, partNoDash: null, backNo: null, boxType: null, qtyPerBox: null, deleted: '1' }))
      .toMatchObject({ partNo: 'M1', uom: 'PC', isActive: false });
  });
});

describe('pickSapPackaging (F-02)', () => {
  const part = { backNo: 'D160 ', boxType: 'B1', qtyPerBox: 10 };
  const kanban = (over: Partial<SapKanbanRow>): SapKanbanRow => ({
    material: 'M1', wcVendor: 'A10000', backNo: 'K-01', boxType: 'BX', qtyPerBox: 50, rack: 'R-3', deleted: '', ...over,
  });
  it('kanban supplier itu lebih dulu, lalu master part', () => {
    expect(pickSapPackaging('A10000', part, [kanban({})])).toEqual({ qtyPerBox: 50, backNo: 'K-01', boxType: 'BX', rack: 'R-3' });
    expect(pickSapPackaging('A10000', part, [kanban({ wcVendor: 'D10000' })])).toEqual({ qtyPerBox: 10, backNo: 'D160', boxType: 'B1', rack: null });
    expect(pickSapPackaging('A10000', part, [kanban({ deleted: 'X' })])).toMatchObject({ qtyPerBox: 10 });
  });
  it('tanpa qty per box atau back number → null, tidak menebak', () => {
    expect(pickSapPackaging('A10000', { ...part, qtyPerBox: 0 }, [])).toBeNull();
    expect(pickSapPackaging('A10000', { ...part, backNo: ' ' }, [])).toBeNull();
  });
});
