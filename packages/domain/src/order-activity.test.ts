import { describe, expect, it } from 'vitest';
import { describeOrderActivity } from './order-activity';

describe('ringkasan aktivitas order', () => {
  it('merangkum receiving parsial tanpa membocorkan snapshot', () => {
    const result = describeOrderActivity('TT_RECEIPT_H', 'CLOSE', null,
      { boxReceived: 2, missingKanbanIds: ['a'], reason: 'Menyusul', passwordHash: 'secret' });
    expect(result).toEqual({ title: 'Receiving selesai', detail: '2 box diterima · 1 box belum diterima · Menyusul' });
    expect(JSON.stringify(result)).not.toContain('secret');
  });
  it('menampilkan revisi dan mengabaikan entitas/aksi di luar order', () => {
    expect(describeOrderActivity('TT_PICKLIST_H', 'CREATE_REVISION', null, null)?.title).toContain('recovery');
    expect(describeOrderActivity('TM_USER', 'UPDATE', null, { email: 'private' })).toBeNull();
    expect(describeOrderActivity('TT_RECEIPT_H', 'UNKNOWN', null, null)).toBeNull();
  });
});
