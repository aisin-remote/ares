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
