import { describe, expect, it } from 'vitest';
import {
  formatOrderSheetNo,
  orderPlantInitial,
  orderSheetBaseNo,
  orderSheetDisplayNo,
} from './order-number';

describe('nomor Order Sheet', () => {
  it('memakai initial plant, tanggal delivery, urutan order, dan recovery', () => {
    expect(formatOrderSheetNo('BODY', '2026-09-23', 1)).toBe('726092300100');
    expect(formatOrderSheetNo('BODY', '2026-09-23', 2, 1)).toBe('726092300201');
    expect(formatOrderSheetNo('UNIT', '2026-09-23', 1)).toBe('826092300100');
    expect(formatOrderSheetNo('ELECTRIC', '2026-09-23', 1)).toBe('926092300100');
  });

  it('menolak plant dan urutan di luar format', () => {
    expect(() => orderPlantInitial('UNKNOWN')).toThrow(/initial/);
    expect(() => formatOrderSheetNo('BODY', '2026-09-23', 0)).toThrow(/1–999/);
    expect(() => formatOrderSheetNo('BODY', '2026-09-23', 1, 100)).toThrow(/0–99/);
  });

  it('mengubah suffix recovery untuk tampilan dan mengembalikannya ke nomor dasar', () => {
    expect(orderSheetDisplayNo('726092300200', 1)).toBe('726092300201');
    expect(orderSheetBaseNo('726092300201')).toEqual({ baseNo: '726092300200', revision: 1 });
    expect(orderSheetDisplayNo('PL-260923-0002', 1)).toBe('PL-260923-0002 rev 1');
    expect(orderSheetBaseNo('PL-260923-0002')).toBeNull();
  });
});
