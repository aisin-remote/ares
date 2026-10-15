import { describe, expect, it } from 'vitest';
import { dueReminderKinds } from './reminder';

const base = {
  status: 'ISSUED' as const,
  createdAt: new Date('2026-09-21T01:00:00Z'),
  arrivalAt: new Date('2026-09-22T07:00:00Z'),
  downloadWarningHours: 2,
  confirmWarningHours: 3,
  downloadedAt: null,
  shippedAt: null,
  downloadReminderAt: null,
  confirmReminderAt: null,
};

describe('dueReminderKinds (F-08)', () => {
  it('tepat pada batas N jam menandai belum unduh', () => {
    expect(dueReminderKinds(base, new Date('2026-09-21T03:00:00Z'))).toEqual(['NOT_DOWNLOADED']);
  });

  it('tepat H jam sebelum kedatangan menandai belum konfirmasi', () => {
    expect(dueReminderKinds(base, new Date('2026-09-22T04:00:00Z'))).toEqual([
      'NOT_DOWNLOADED',
      'NOT_CONFIRMED',
    ]);
  });

  it('jenis yang sudah dipicu dan picklist SHIPPED tidak dipicu lagi', () => {
    expect(dueReminderKinds({ ...base, downloadReminderAt: new Date() }, new Date('2026-09-21T03:00:00Z'))).toEqual([]);
    expect(dueReminderKinds({ ...base, status: 'SHIPPED', shippedAt: new Date() }, new Date('2026-09-22T04:00:00Z'))).toEqual([]);
  });
});
