import { describe, expect, it } from 'vitest';
import { nextCutoff } from './cutoff';

const schedule = {
  cutoffTime: '10:00:00',
  workdays: '1,2,3,4,5',
  leadDays: 1,
  arrivalTime: '14:00:00',
  holidayShift: 'AFTER' as const,
  holidays: [] as string[],
};

describe('nextCutoff (PRD 6.2)', () => {
  it('memakai jam Jakarta dan memasukkan detik cutoff ke jadwal berikutnya', () => {
    expect(nextCutoff({ ...schedule, now: new Date('2026-09-21T02:59:59Z') })).toEqual({
      cutoffAt: new Date('2026-09-21T03:00:00Z'),
      deliveryDate: '2026-09-22',
      arrivalAt: new Date('2026-09-22T07:00:00Z'),
    });
    expect(nextCutoff({ ...schedule, now: new Date('2026-09-21T03:00:00Z') })?.cutoffAt).toEqual(
      new Date('2026-09-22T03:00:00Z'),
    );
  });

  it('melewati akhir pekan dan libur saat menghitung lead days', () => {
    expect(
      nextCutoff({
        ...schedule,
        now: new Date('2026-09-18T02:00:00Z'),
        holidays: ['2026-09-21'],
      }),
    ).toEqual({
      cutoffAt: new Date('2026-09-18T03:00:00Z'),
      deliveryDate: '2026-09-22',
      arrivalAt: new Date('2026-09-22T07:00:00Z'),
    });
  });

  it('menggeser cutoff libur ke hari kerja sesudahnya', () => {
    expect(
      nextCutoff({
        ...schedule,
        now: new Date('2026-09-18T03:00:00Z'),
        holidays: ['2026-09-21'],
      })?.cutoffAt,
    ).toEqual(new Date('2026-09-22T03:00:00Z'));
  });

  it('menggeser cutoff libur ke hari kerja sebelumnya, termasuk jadwal nominal masa depan', () => {
    expect(
      nextCutoff({
        ...schedule,
        now: new Date('2026-09-17T03:00:00Z'),
        holidayShift: 'BEFORE',
        holidays: ['2026-09-18', '2026-09-21'],
      })?.cutoffAt,
    ).toEqual(new Date('2026-09-22T03:00:00Z'));
  });
});
