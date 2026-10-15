import { describe, expect, it } from 'vitest';
import { orderSheetCsv, ORDER_SHEET_CSV_HEADERS } from './order-sheet-csv';
import type { PicklistDocData } from './document.types';

const data: PicklistDocData = {
  picklistNo: '726092300100', revision: 1, type: 'AUTO', cycle: 1,
  cutoffAt: new Date('2026-09-23T14:00:00.000Z'), deliveryDate: '2026-09-23',
  arrivalTime: '23:00:00', note: null, vendorName: 'PT Supplier', sapVendorNo: 'J901',
  vendorAddress: null, vendorScheduleCode: '01', truckStation: '11', vehicleNo: null,
  plantCode: 'BODY', plantName: 'AIIA Body', totalBox: 2, totalPcs: 160, totalKanban: 2,
  lines: [{ no: 1, partNo: '423175-10610', partName: 'BELLCRANK', sapMaterialNo: 'PC3P',
    uom: 'PCS', backNo: 'MC1P', rack: null, boxType: null, qtyPerBox: 80,
    boxOrdered: 2, pcs: 160, sapPoNo: '4500', sapPoItem: '10', serialFrom: 1, serialTo: 2 }],
};

describe('orderSheetCsv', () => {
  it('mengikuti format supplier: BOM UTF-16LE, tab, 36 kolom, apostrophe, nomor recovery', () => {
    const out = orderSheetCsv(data);
    expect([...out.subarray(0, 2)]).toEqual([0xff, 0xfe]);
    const rows = out.subarray(2).toString('utf16le').trimEnd().split('\r\n');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.split('\t')).toHaveLength(ORDER_SHEET_CSV_HEADERS.length);
    const cells = rows[1]!.split('\t');
    expect(cells).toHaveLength(36);
    expect(cells[24]).toBe('"\'2026/09/23"');
    expect(cells[25]).toBe('"\'21:00"');
    expect(cells[35]).toBe('"\'726092300101"');
  });
});
