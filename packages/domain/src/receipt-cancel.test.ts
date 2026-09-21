import { describe, expect, it } from 'vitest';
import { kanbanStatusAfterReceiptCancel, picklistStatusAfterReceiptCancel } from './receipt-cancel';

describe('pembatalan receipt (F-40)', () => {
  it('mengembalikan picklist ke status sebelum penerimaan', () => {
    expect(picklistStatusAfterReceiptCancel({ shippedAt: null, downloadedAt: null })).toBe('ISSUED');
    expect(picklistStatusAfterReceiptCancel({ shippedAt: null, downloadedAt: new Date() })).toBe('DOWNLOADED');
    expect(picklistStatusAfterReceiptCancel({ shippedAt: new Date(), downloadedAt: new Date() })).toBe('SHIPPED');
  });

  it('mengembalikan kanban sesuai asal konfirmasi kirim', () => {
    expect(kanbanStatusAfterReceiptCancel(true)).toBe('PRINTED');
    expect(kanbanStatusAfterReceiptCancel(false)).toBe('SHIPPED');
  });
});
