import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { ManualOrderImportError, parseManualOrderWorkbook } from './manual-order-import';

async function workbook(lines: Array<[string, number]>): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('ORDER_MANUAL');
  sheet.getCell('B3').value = '00001234';
  sheet.getCell('B4').value = new Date('2026-09-25T00:00:00Z');
  sheet.getCell('B5').value = '09:30';
  sheet.getCell('B6').value = 'Order tambahan';
  sheet.getRow(8).values = ['NOMOR_MATERIAL_SAP', 'JUMLAH_BOX'];
  lines.forEach((line, index) => { sheet.getRow(9 + index).values = line; });
  return Buffer.from(await book.xlsx.writeBuffer());
}

describe('parseManualOrderWorkbook', () => {
  it('membaca satu order dan menolak material ganda', async () => {
    await expect(parseManualOrderWorkbook(await workbook([['MAT-01', 2], ['MAT-02', 3]])))
      .resolves.toEqual({
        sapVendorNo: '00001234',
        deliveryDate: '2026-09-25',
        cutoffTime: '09:30:00',
        note: 'Order tambahan',
        lines: [
          { row: 9, sapMaterialNo: 'MAT-01', boxes: 2 },
          { row: 10, sapMaterialNo: 'MAT-02', boxes: 3 },
        ],
      });

    await expect(parseManualOrderWorkbook(await workbook([['MAT-01', 2], ['MAT-01', 1]])))
      .rejects.toBeInstanceOf(ManualOrderImportError);
  });
});
