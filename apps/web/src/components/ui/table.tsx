import { cn } from './cn';

/**
 * Tabel sederhana dengan gaya kartu.
 *
 * Dibungkus overflow-x-auto: tabel adalah satu-satunya elemen yang boleh lebih
 * lebar dari layar, dan itu pun harus menggulir sendiri agar badan halaman
 * tidak ikut bergeser ke samping.
 */
export function Table({
  children,
  scroll = false,
}: {
  children: React.ReactNode;
  /** Batasi tinggi tabel panjang agar kepala kolom tetap terlihat saat digulir. */
  scroll?: boolean;
}) {
  return (
    <div
      className={cn(
        'scroll-slim overflow-x-auto [&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-20 [&_thead_th]:bg-card',
        scroll && 'max-h-[70vh] overflow-auto',
      )}
    >
      <table className="w-full border-collapse text-[14px]">{children}</table>
    </div>
  );
}

export function Th({
  children,
  align = 'left',
  sticky,
}: {
  children: React.ReactNode;
  /** `center` dipakai kolom yang isinya sekumpulan tombol, bukan teks atau angka. */
  align?: 'left' | 'right' | 'center';
  sticky?: 'left' | 'right';
}) {
  return (
    <th
      scope="col"
      className={cn(
        'whitespace-nowrap border-b border-line px-6 py-3 text-[12px] font-semibold uppercase tracking-wide text-ink-muted',
        align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left',
        sticky === 'left' && '!z-30 left-0 border-r border-line',
        sticky === 'right' && '!z-30 right-0 border-l border-line',
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align = 'left',
  strong = false,
  className,
  sticky,
}: {
  children: React.ReactNode;
  align?: 'left' | 'right' | 'center';
  strong?: boolean;
  className?: string;
  sticky?: 'left' | 'right';
}) {
  return (
    <td
      className={cn(
        'border-b border-line px-6 py-3.5 text-ink-soft',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        strong && 'font-semibold text-ink',
        sticky === 'left' && 'sticky left-0 z-10 border-r border-line bg-card',
        sticky === 'right' && 'sticky right-0 z-10 border-l border-line bg-card',
        className,
      )}
    >
      {children}
    </td>
  );
}

/** Baris tabel dengan sorotan halus saat disapu kursor. */
export function Tr({ children }: { children: React.ReactNode }) {
  return (
    <tr className="relative transition-colors duration-150 last:[&>td]:border-b-0 hover:bg-surface">
      {children}
    </tr>
  );
}

/** Keadaan kosong — selalu jelaskan langkah berikutnya, jangan hanya "tidak ada data". */
export function EmptyState({ children, colSpan }: { children: React.ReactNode; colSpan: number }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-6 py-14 text-center text-[14px] text-ink-muted">
        {children}
      </td>
    </tr>
  );
}
