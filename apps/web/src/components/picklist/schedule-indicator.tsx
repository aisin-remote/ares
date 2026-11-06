import { cn } from '../ui/cn';
import { penandaKedatangan, waktuRelatif } from './status';

export function ArrivalIndicator({
  deliveryDate,
  arrivalTime,
  status,
  now,
  className,
}: {
  deliveryDate: string;
  arrivalTime: string;
  status: string;
  now?: Date;
  className?: string;
}) {
  const marker = penandaKedatangan(deliveryDate, arrivalTime, status, now);
  if (!marker) return null;
  return (
    <span
      className={cn(
        'inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold',
        marker.tone === 'danger' ? 'bg-ng/10 text-ng' : 'bg-warn/10 text-warn',
        className,
      )}
    >
      {marker.label}
    </span>
  );
}

/** `at` = 00:00 WIB hari cutoff (F-04): sepanjang hari itu Order Sheet siap diterbitkan. */
export function CutoffIndicator({ at, now }: { at: Date | string; now?: Date }) {
  const relative = waktuRelatif(at, now);
  const hariIni = relative.lewat && relative.selisihMs > -24 * 60 * 60_000;
  return (
    <span
      className={cn(
        'mt-1 block text-[11px] font-semibold',
        hariIni ? 'text-warn' : relative.lewat ? 'text-ng' : 'text-ink-muted',
      )}
    >
      {hariIni ? 'Cutoff hari ini' : relative.lewat ? `Lewat ${relative.durasi}` : `Cutoff ${relative.durasi} lagi`}
    </span>
  );
}
