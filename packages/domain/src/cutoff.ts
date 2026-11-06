/**
 * PRD 6.2: kalender cutoff pabrik Asia/Jakarta (UTC+7).
 *
 * Cutoff hanya punya hari, tanpa jam: `cutoffAt` adalah 00:00 WIB hari cutoff,
 * sehingga PPIC boleh menerbitkan Order Sheet sejak pagi hari itu.
 */
export interface NextCutoffInput {
  now: Date;
  /** Hari cutoff ISO, dipisahkan koma: 1=Senin sampai 7=Minggu. */
  workdays: string;
  leadDays: number;
  arrivalTime: string;
  holidayShift: 'BEFORE' | 'AFTER';
  holidays: readonly string[];
}

export interface NextCutoffResult {
  cutoffAt: Date;
  deliveryDate: string;
  arrivalAt: Date;
}

export interface DeliveryCalendarSlot {
  dayOfWeek: number;
  arrivalTime: string;
}

export interface NextScheduledDeliveryInput {
  /** Tanggal paling awal hasil perhitungan lead time, bentuk YYYY-MM-DD. */
  notBeforeDate: string;
  slots: readonly DeliveryCalendarSlot[];
  workdays: string;
  holidayShift: 'BEFORE' | 'AFTER';
  holidays: readonly string[];
}

export interface ScheduledDeliveryResult {
  deliveryDate: string;
  arrivalTime: string;
  arrivalAt: Date;
}

const JAKARTA_OFFSET = 7 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

function timeMs(value: string): number {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) throw new Error(`Jam tidak valid: ${value}`);
  const [, hour, minute, second = '00'] = match;
  const h = Number(hour);
  const m = Number(minute);
  const s = Number(second);
  if (h > 23 || m > 59 || s > 59) throw new Error(`Jam tidak valid: ${value}`);
  return ((h * 60 + m) * 60 + s) * 1000;
}

function dateText(day: number): string {
  return new Date(day).toISOString().slice(0, 10);
}

/**
 * Hari cutoff pertama yang tanggalnya tidak sebelum tanggal `now` — hari ini
 * ikut dihitung. Pergeseran libur mengikuti kebijakan supplier, lalu lead time
 * dihitung dalam hari kerja.
 */
export function nextCutoff(input: NextCutoffInput): NextCutoffResult | null {
  const arrivalMs = timeMs(input.arrivalTime);
  const workdays = new Set(input.workdays.split(',').map((day) => Number(day.trim())));
  if (workdays.size === 0 || [...workdays].some((day) => !Number.isInteger(day) || day < 1 || day > 7)) {
    throw new Error('Hari kerja harus berupa angka 1–7');
  }
  if (!Number.isInteger(input.leadDays) || input.leadDays < 0) throw new Error('Lead days tidak valid');
  if (!Number.isFinite(input.now.getTime())) throw new Error('Waktu sekarang tidak valid');

  const holidays = new Set(input.holidays);
  const isWorkday = (day: number) => {
    const weekday = new Date(day).getUTCDay() || 7;
    return workdays.has(weekday) && !holidays.has(dateText(day));
  };
  const start = Math.floor((input.now.getTime() + JAKARTA_OFFSET) / DAY) * DAY;
  let next: number | null = null;

  // Sertakan jadwal nominal lampau: libur beruntun bisa menggesernya ke depan.
  for (let nominal = start - (holidays.size + 7) * DAY; nominal < start + 366 * DAY; nominal += DAY) {
    const weekday = new Date(nominal).getUTCDay() || 7;
    if (!workdays.has(weekday)) continue;

    let effective = nominal;
    if (holidays.has(dateText(nominal))) {
      const direction = input.holidayShift === 'BEFORE' ? -1 : 1;
      do effective += direction * DAY;
      while (!isWorkday(effective));
    }
    const cutoffAt = effective - JAKARTA_OFFSET;
    if (effective >= start && (next === null || cutoffAt < next)) next = cutoffAt;
  }
  if (next === null) return null;

  let deliveryDay = Math.floor((next + JAKARTA_OFFSET) / DAY) * DAY;
  for (let remaining = input.leadDays; remaining > 0;) {
    deliveryDay += DAY;
    if (isWorkday(deliveryDay)) remaining--;
  }
  return {
    cutoffAt: new Date(next),
    deliveryDate: dateText(deliveryDay),
    arrivalAt: new Date(deliveryDay + arrivalMs - JAKARTA_OFFSET),
  };
}

/**
 * Pilih slot kedatangan periodik pertama setelah lead time cutoff terpenuhi.
 * DAY pada master receiving menjadi kalender yang menentukan tanggal dan ETA
 * picklist otomatis; arrivalTime pada cutoff hanya memilih siklus/slotnya.
 */
export function nextScheduledDelivery(input: NextScheduledDeliveryInput): ScheduledDeliveryResult | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.notBeforeDate)) throw new Error('Tanggal minimum tidak valid');
  const start = Date.parse(`${input.notBeforeDate}T00:00:00Z`);
  if (!Number.isFinite(start) || dateText(start) !== input.notBeforeDate) throw new Error('Tanggal minimum tidak valid');
  const workdays = new Set(input.workdays.split(',').map((day) => Number(day.trim())));
  if (workdays.size === 0 || [...workdays].some((day) => !Number.isInteger(day) || day < 1 || day > 7))
    throw new Error('Hari kerja harus berupa angka 1–7');
  if (input.slots.some((slot) => !Number.isInteger(slot.dayOfWeek) || slot.dayOfWeek < 1 || slot.dayOfWeek > 7))
    throw new Error('Hari jadwal delivery tidak valid');

  const holidays = new Set(input.holidays);
  const isWorkday = (day: number) => {
    const weekday = new Date(day).getUTCDay() || 7;
    return workdays.has(weekday) && !holidays.has(dateText(day));
  };
  let selected: ScheduledDeliveryResult | null = null;
  for (let nominal = start; nominal < start + 366 * DAY; nominal += DAY) {
    const weekday = new Date(nominal).getUTCDay() || 7;
    for (const slot of input.slots) {
      if (slot.dayOfWeek !== weekday) continue;
      let effective = nominal;
      if (holidays.has(dateText(nominal))) {
        const direction = input.holidayShift === 'BEFORE' ? -1 : 1;
        do effective += direction * DAY;
        while (!isWorkday(effective));
      }
      if (effective < start) continue;
      const arrivalAt = new Date(effective + timeMs(slot.arrivalTime) - JAKARTA_OFFSET);
      if (!selected || arrivalAt < selected.arrivalAt) {
        selected = {
          deliveryDate: dateText(effective),
          arrivalTime: slot.arrivalTime,
          arrivalAt,
        };
      }
    }
    if (selected) return selected;
  }
  return null;
}

/**
 * Tanggal kirim Order Sheet untuk satu cutoff antrean (6.2): lead time dari
 * hari cutoff, lalu digeser ke hari kirim rutin supplier bila diatur. Dipakai
 * penerbitan cutoff dan layar persiapan, supaya PO bulan kirim yang tampil
 * sama dengan yang dipakai saat terbit (F-44).
 */
export function deliveryForCutoff(
  input: Omit<NextCutoffInput, 'now'> & { cutoffAt: Date; deliveryDays: string | null | undefined },
): { deliveryDate: string; arrivalTime: string } | { error: string } {
  const timing = nextCutoff({ ...input, now: input.cutoffAt });
  if (!timing || timing.cutoffAt.getTime() !== input.cutoffAt.getTime()) {
    return { error: 'Tanggal cutoff tidak sesuai dengan kalender supplier yang aktif' };
  }
  const days = input.deliveryDays?.trim();
  if (!days) return { deliveryDate: timing.deliveryDate, arrivalTime: input.arrivalTime };
  const scheduled = nextScheduledDelivery({
    notBeforeDate: timing.deliveryDate,
    slots: days.split(',').map((day) => ({ dayOfWeek: Number(day.trim()), arrivalTime: input.arrivalTime })),
    workdays: days,
    holidayShift: input.holidayShift,
    holidays: input.holidays,
  });
  if (!scheduled) return { error: 'Periode pengiriman supplier tidak menghasilkan tanggal delivery berikutnya' };
  return { deliveryDate: scheduled.deliveryDate, arrivalTime: scheduled.arrivalTime };
}
