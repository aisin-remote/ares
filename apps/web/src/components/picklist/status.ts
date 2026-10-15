/**
 * Label dan warna status picklist (PRD §3), dipakai halaman daftar dan detail.
 *
 * Hanya pemetaan tampilan — aturan transisinya ada di packages/domain.
 */
export const STATUS_LABEL: Record<string, string> = {
  ISSUED: 'Terbit',
  DOWNLOADED: 'Diunduh supplier',
  SHIPPED: 'Dikirim',
  PARTIAL: 'Diterima sebagian',
  COMPLETE: 'Selesai',
  CANCELLED: 'Dibatalkan',
};

export const STATUS_TONE: Record<string, string> = {
  ISSUED: 'border-accent/40 bg-accent/10 text-accent',
  DOWNLOADED: 'border-live/40 bg-live/10 text-live',
  SHIPPED: 'border-warn/40 bg-warn/10 text-warn',
  PARTIAL: 'border-warn/40 bg-warn/10 text-warn',
  COMPLETE: 'border-ok/40 bg-ok/10 text-ok',
  CANCELLED: 'border-line text-ink-muted',
};

export const LINE_STATUS_LABEL: Record<string, string> = {
  OPEN: 'Menunggu',
  SHORT: 'Kurang',
  RECEIVED: 'Diterima',
  CANCELLED: 'Dibatalkan',
};

/** Tanggal kalender polos (YYYY-MM-DD) — tanpa geser zona waktu. */
export function tanggal(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** Waktu tersimpan UTC, ditampilkan jam pabrik (aturan repo 6). */
export function waktu(at: Date | string): string {
  return new Date(at).toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Jakarta',
  });
}

/** TIME dari MySQL datang sebagai HH:MM:SS; detiknya tidak pernah dipakai. */
export function jam(t: string): string {
  return t.slice(0, 5);
}

/** Durasi pendek untuk penanda operasional: "45 menit", "3 jam", "2 hari". */
export function durasiRingkas(milliseconds: number): string {
  const nilai = Math.abs(milliseconds);
  if (nilai < 60_000) return 'kurang dari 1 menit';
  if (nilai < 2 * 60 * 60_000) return `${Math.ceil(nilai / 60_000)} menit`;
  if (nilai < 2 * 24 * 60 * 60_000) return `${Math.ceil(nilai / 3_600_000)} jam`;
  return `${Math.ceil(nilai / 86_400_000)} hari`;
}

export function waktuRelatif(target: Date | string, now = new Date()) {
  const selisihMs = new Date(target).getTime() - now.getTime();
  return {
    selisihMs,
    lewat: selisihMs < 0,
    durasi: durasiRingkas(selisihMs),
  };
}

/** Penanda yang langsung menjelaskan apakah jadwal kedatangan masih aman. */
export function penandaKedatangan(
  deliveryDate: string,
  arrivalTime: string,
  status: string,
  now = new Date(),
): { label: string; tone: 'danger' | 'warn' } | null {
  if (status === 'COMPLETE' || status === 'CANCELLED') return null;
  const target = new Date(`${deliveryDate}T${arrivalTime.slice(0, 8)}+07:00`);
  const relatif = waktuRelatif(target, now);
  if (relatif.lewat) {
    return {
      label:
        status === 'ISSUED' || status === 'DOWNLOADED'
          ? `Terlambat ${relatif.durasi}`
          : `Lewat jadwal ${relatif.durasi}`,
      tone: 'danger',
    };
  }
  if (relatif.selisihMs <= 24 * 60 * 60_000) {
    return { label: `Tiba ${relatif.durasi} lagi`, tone: 'warn' };
  }
  return null;
}
