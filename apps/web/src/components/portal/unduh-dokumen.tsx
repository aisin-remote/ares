import { FileDown, FileSpreadsheet, Loader2, QrCode } from 'lucide-react';
import { cn } from '../ui/cn';

/**
 * Tautan unduh Order Sheet, Kanban, dan CSV.
 *
 * Tautan biasa, bukan tombol: komponen Button menerima ikon berupa fungsi dan
 * hanya boleh dipanggil dari komponen klien, sedangkan unduhan justru paling
 * baik sebagai `<a>` — klik kanan "simpan sebagai" dan buka di tab baru tetap
 * bekerja seperti yang diharapkan orang.
 *
 * Unduhan PERTAMA oleh supplier menandai picklist DOWNLOADED (F-29); yang
 * melakukannya API, bukan layar ini.
 */
export function UnduhDokumen({
  picklistId,
  siap,
  ukuran = 'md',
}: {
  picklistId: string;
  /** PDF baru ada setelah worker selesai merender (F-27). */
  siap: boolean;
  ukuran?: 'sm' | 'md';
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

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <a
        href={`/api/picklist/${picklistId}/pdf`}
        className={cn(pil, 'bg-accent text-white hover:bg-accent-soft', dasar)}
      >
        <FileDown className="size-4" strokeWidth={2} aria-hidden />
        Order Sheet PDF
      </a>
      <a href={`/api/picklist/${picklistId}/kanban`} className={cn(garis, dasar)}>
        <QrCode className="size-4" strokeWidth={2} aria-hidden />
        Kanban PDF
      </a>
      <a href={`/api/picklist/${picklistId}/csv`} className={cn(garis, dasar)}>
        <FileSpreadsheet className="size-4" strokeWidth={2} aria-hidden />
        CSV
      </a>
    </span>
  );
}
