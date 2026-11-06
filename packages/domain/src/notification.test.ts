import { describe, expect, it } from 'vitest';
import { noticeResendBlock } from './notification';

describe('batas kirim ulang email', () => {
  const now = new Date('2026-10-22T03:00:00Z');
  const old = new Date(now.getTime() - 60_000);
  it('menolak order batal, email aktif, dan klik berulang', () => {
    expect(noticeResendBlock('CANCELLED', undefined, now)).toBeTruthy();
    for (const status of ['QUEUED', 'PROCESSING'] as const)
      expect(noticeResendBlock('ISSUED', { status, createdAt: old }, now)).toBeTruthy();
    expect(noticeResendBlock('ISSUED', { status: 'FAILED', createdAt: now }, now)).toBeTruthy();
  });
  it('mengizinkan permintaan pertama dan pengiriman ulang setelah jeda', () => {
    expect(noticeResendBlock('ISSUED', undefined, now)).toBeNull();
    for (const status of ['ACCEPTED', 'FAILED', 'SKIPPED'] as const)
      expect(noticeResendBlock('ISSUED', { status, createdAt: old }, now)).toBeNull();
  });
});
