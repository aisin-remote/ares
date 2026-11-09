import { describe, expect, it } from 'vitest';
import { PASSWORD_MAX_AGE_DAYS, passwordDaysLeft, passwordExpired } from './password';

const now = new Date('2026-11-09T02:00:00Z');
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);

describe('passwordExpired', () => {
  it('membebaskan admin berapa pun umur passwordnya', () => {
    expect(passwordExpired({ role: 'admin', changedAt: daysAgo(400), now })).toBe(false);
    expect(passwordExpired({ role: 'admin', changedAt: null, now })).toBe(false);
  });

  it('meminta ganti setelah 90 hari untuk peran lain', () => {
    expect(passwordExpired({ role: 'ppic', changedAt: daysAgo(89), now })).toBe(false);
    expect(passwordExpired({ role: 'ppic', changedAt: daysAgo(90), now })).toBe(true);
    expect(passwordExpired({ role: 'supplier', changedAt: daysAgo(120), now })).toBe(true);
  });

  it('menganggap catatan kosong sebagai kedaluwarsa', () => {
    expect(passwordExpired({ role: 'warehouse', changedAt: null, now })).toBe(true);
    expect(passwordExpired({ role: null, changedAt: null, now })).toBe(true);
  });

  it('memakai batas 90 hari sebagai bawaan', () => {
    expect(PASSWORD_MAX_AGE_DAYS).toBe(90);
    expect(passwordExpired({ role: 'ppic', changedAt: daysAgo(10), now, maxAgeDays: 7 })).toBe(true);
  });
});

describe('passwordDaysLeft', () => {
  it('menghitung sisa hari dan menandai yang sudah lewat', () => {
    expect(passwordDaysLeft({ changedAt: daysAgo(80), now })).toBe(10);
    expect(passwordDaysLeft({ changedAt: daysAgo(95), now })).toBe(-5);
  });
});
