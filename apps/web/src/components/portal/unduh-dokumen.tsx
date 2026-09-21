import { FileDown, Loader2, QrCode } from 'lucide-react';
import { cn } from '../ui/cn';

/**
 * Tautan unduh PDF picklist dan kanban.
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
  picklistId: number;
  /** PDF baru ada setelah worker selesai merender (F-27). */
  siap: boolean;
  ukuran?: 'sm' | 'md';
}) {
  const dasar =
    ukuran === 'sm'
      ? 'h-9 px-3.5 text-[13px] gap-1.5'
      : 'h-11 px-5 text-[14px] gap-2';

  if (!siap) {
    return (
      <span
        className={cn(
          'inline-flex items-center rounded-full border border-line font-semibold text-ink-muted',
          dasar,
        )}
      >
        <Loader2 className="size-4 animate-spin" strokeWidth={2} aria-hidden />
        PDF sedang dibuat…
      </span>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <a
        href={`/api/picklist/${picklistId}/pdf`}
        className={cn(
          'inline-flex items-center rounded-full border border-line bg-card font-semibold transition-colors hover:border-ink',
          dasar,
        )}
      >
        <FileDown className="size-4" strokeWidth={2} aria-hidden />
        Picklist
      </a>
      <a
        href={`/api/picklist/${picklistId}/kanban`}
        className={cn(
          'inline-flex items-center rounded-full bg-accent font-semibold text-white transition-colors hover:bg-accent-soft',
          dasar,
        )}
      >
        <QrCode className="size-4" strokeWidth={2.2} aria-hidden />
        Kanban
      </a>
    </span>
  );
}
