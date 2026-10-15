import { FileDown, FileSpreadsheet, Loader2, Package, QrCode } from 'lucide-react';
import { cn } from '../ui/cn';

/**
 * Tautan unduh Order Sheet, Kanban, dan CSV.
 *
 * Tautan biasa, bukan tombol: komponen Button menerima ikon berupa fungsi dan
 * hanya boleh dipanggil dari komponen klien, sedangkan unduhan justru paling
 * baik sebagai `<a>` — klik kanan "simpan sebagai" dan buka di tab baru tetap
 * bekerja seperti yang diharapkan orang.
 *
 * Dua bentuk:
 *   `ringkas`  satu tombol ZIP berisi ketiganya — dipakai di dalam tabel,
 *              tempat tiga tombol berjejer selalu pecah jadi dua baris.
 *   `lengkap`  ZIP ditambah tiga tautan satuan, untuk halaman detail yang
 *              memang punya ruang dan kadang hanya perlu satu berkas.
 *
 * Unduhan PERTAMA oleh supplier menandai picklist DOWNLOADED (F-29); yang
 * melakukannya API, bukan layar ini.
 */
export function UnduhDokumen({
  picklistId,
  siap,
  ukuran = 'md',
  bentuk = 'lengkap',
}: {
  picklistId: string;
  /** PDF baru ada setelah worker selesai merender (F-27). */
  siap: boolean;
  ukuran?: 'sm' | 'md';
  bentuk?: 'lengkap' | 'ringkas';
}) {
  const dasar = ukuran === 'sm' ? 'h-9 px-3.5 text-[13px] gap-1.5' : 'h-11 px-5 text-[14px] gap-2';
  const pil = 'inline-flex items-center rounded-full font-semibold transition-colors';
  const garis = `${pil} border border-line bg-card hover:border-ink`;

  if (!siap) {
    return (
      <span className={cn(garis, 'text-ink-muted', dasar)}>
        <Loader2 className="size-4 animate-spin" strokeWidth={2} aria-hidden />
        PDF sedang dibuat…
      </span>
    );
  }

  const semua = (
    <a
      href={`/api/picklist/${picklistId}/semua`}
      className={cn(pil, 'bg-accent text-white hover:bg-accent-soft', dasar)}
    >
      <Package className="size-4" strokeWidth={2.2} aria-hidden />
      Unduh semua
    </a>
  );

  if (bentuk === 'ringkas') return semua;

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {semua}
      <a href={`/api/picklist/${picklistId}/pdf`} className={cn(garis, dasar)}>
        <FileDown className="size-4" strokeWidth={2} aria-hidden />
        Order Sheet
      </a>
      <a href={`/api/picklist/${picklistId}/kanban`} className={cn(garis, dasar)}>
        <QrCode className="size-4" strokeWidth={2} aria-hidden />
        Kanban
      </a>
      <a href={`/api/picklist/${picklistId}/csv`} className={cn(garis, dasar)}>
        <FileSpreadsheet className="size-4" strokeWidth={2} aria-hidden />
        CSV
      </a>
    </span>
  );
}
