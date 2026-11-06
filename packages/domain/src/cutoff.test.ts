import { describe, expect, it } from 'vitest';
import { deliveryForCutoff, nextCutoff, nextScheduledDelivery } from './cutoff';

const schedule = {
  workdays: '1,2,3,4,5',
  leadDays: 1,
  arrivalTime: '14:00:00',
  holidayShift: 'AFTER' as const,
  holidays: [] as string[],
};

describe('nextCutoff (PRD 6.2)', () => {
  it('cutoff adalah 00:00 WIB hari cutoff dan hari ini ikut dihitung sampai tengah malam', () => {
    // Senin 21 Sep 2026: 00:00 WIB = 20 Sep 17:00 UTC.
    const senin = {
      cutoffAt: new Date('2026-09-20T17:00:00Z'),
      deliveryDate: '2026-09-22',
      arrivalAt: new Date('2026-09-22T07:00:00Z'),
    };
    expect(nextCutoff({ ...schedule, now: new Date('2026-09-20T17:00:00Z') })).toEqual(senin);
    expect(nextCutoff({ ...schedule, now: new Date('2026-09-21T16:59:59Z') })).toEqual(senin);
    expect(nextCutoff({ ...schedule, now: new Date('2026-09-21T17:00:00Z') })?.cutoffAt).toEqual(
      new Date('2026-09-21T17:00:00Z'),
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
      cutoffAt: new Date('2026-09-17T17:00:00Z'),
      deliveryDate: '2026-09-22',
      arrivalAt: new Date('2026-09-22T07:00:00Z'),
    });
  });

  it('menggeser cutoff libur ke hari kerja sesudahnya', () => {
    expect(
      nextCutoff({
        ...schedule,
        now: new Date('2026-09-18T17:00:00Z'), // Sabtu
        holidays: ['2026-09-21'],
      })?.cutoffAt,
    ).toEqual(new Date('2026-09-21T17:00:00Z'));
  });

  it('menggeser cutoff libur ke hari kerja sebelumnya, termasuk jadwal nominal masa depan', () => {
    expect(
      nextCutoff({
        ...schedule,
        now: new Date('2026-09-17T17:00:00Z'), // Jumat
        holidayShift: 'BEFORE',
        holidays: ['2026-09-18', '2026-09-21'],
      })?.cutoffAt,
    ).toEqual(new Date('2026-09-21T17:00:00Z'));
  });
});

describe('nextScheduledDelivery', () => {
  it('memakai DAY jadwal receiving sebagai tanggal auto ordering', () => {
    expect(nextScheduledDelivery({
      notBeforeDate: '2026-09-22', // Selasa
      slots: [{ dayOfWeek: 5, arrivalTime: '08:00:00' }],
      workdays: '1,2,3,4,5',
      holidayShift: 'AFTER',
      holidays: [],
    })).toEqual({
      deliveryDate: '2026-09-25',
      arrivalTime: '08:00:00',
      arrivalAt: new Date('2026-09-25T01:00:00Z'),
    });
  });

  it('memilih ETA pertama pada hari yang sama dan menggeser jadwal libur', () => {
    expect(nextScheduledDelivery({
      notBeforeDate: '2026-09-21',
      slots: [
        { dayOfWeek: 1, arrivalTime: '16:30:00' },
        { dayOfWeek: 1, arrivalTime: '04:00:00' },
      ],
      workdays: '1,2,3,4,5',
      holidayShift: 'AFTER',
      holidays: ['2026-09-21'],
    })).toEqual({
      deliveryDate: '2026-09-22',
      arrivalTime: '04:00:00',
      arrivalAt: new Date('2026-09-21T21:00:00Z'),
    });
  });
});

describe('deliveryForCutoff (6.2, F-44)', () => {
  // Kamis 29 Okt 2026 00:00 WIB = 28 Okt 17:00 UTC.
  const cutoffAt = new Date('2026-10-28T17:00:00Z');
  it('lead time dari cutoff; lintas bulan menentukan PO bulan kirim', () => {
    expect(deliveryForCutoff({ ...schedule, leadDays: 2, cutoffAt, deliveryDays: null }))
      .toEqual({ deliveryDate: '2026-11-02', arrivalTime: '14:00:00' });
  });
  it('digeser ke hari kirim rutin supplier', () => {
    expect(deliveryForCutoff({ ...schedule, cutoffAt, deliveryDays: '3' }))
      .toMatchObject({ deliveryDate: '2026-11-04' });
  });
  it('cutoff yang tidak cocok kalender ditolak dengan alasan', () => {
    expect(deliveryForCutoff({ ...schedule, cutoffAt: new Date('2026-10-28T18:00:00Z'), deliveryDays: null }))
      .toHaveProperty('error');
  });
});
