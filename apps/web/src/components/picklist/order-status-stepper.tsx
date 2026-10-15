import type { PicklistStatus } from '@ares/contracts';
import { Check, X } from 'lucide-react';
import { cn } from '@/components/ui/cn';

const STEPS = ['Terbit', 'Diunduh', 'Dikirim', 'Receiving', 'Selesai'] as const;

const CURRENT_STEP: Record<PicklistStatus, number> = {
  ISSUED: 0,
  DOWNLOADED: 1,
  SHIPPED: 2,
  PARTIAL: 3,
  COMPLETE: 4,
  CANCELLED: -1,
};

const EXPLANATION: Record<PicklistStatus, string> = {
  ISSUED: 'Menunggu supplier mengunduh dokumen order.',
  DOWNLOADED: 'Dokumen sudah diunduh. Menunggu supplier mengonfirmasi pengiriman.',
  SHIPPED: 'Barang sedang dikirim dan menunggu proses Receiving.',
  PARTIAL: 'Sebagian barang sudah diterima. Kekurangan akan masuk ke order berikutnya.',
  COMPLETE: 'Seluruh barang pada order ini sudah diterima.',
  CANCELLED: 'Order dibatalkan dan tidak diproses lebih lanjut.',
};

/** Alur ringkas agar pengguna langsung tahu posisi order dan langkah berikutnya. */
export function OrderStatusStepper({ status }: { status: PicklistStatus }) {
  if (status === 'CANCELLED') {
    return (
      <div className="flex items-center gap-3 rounded-card border border-ng/25 bg-ng/8 px-5 py-4 text-ng">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-ng text-white">
          <X className="size-4" strokeWidth={2.4} aria-hidden />
        </span>
        <div>
          <p className="text-[14px] font-bold">Order dibatalkan</p>
          <p className="mt-0.5 text-[13px] opacity-85">{EXPLANATION[status]}</p>
        </div>
      </div>
    );
  }

  const current = CURRENT_STEP[status];

  return (
    <section
      className="rounded-card border border-line bg-card px-5 py-4"
      aria-label="Alur status order"
    >
      <div className="scroll-slim overflow-x-auto pb-1">
        <ol className="grid min-w-[520px] grid-cols-5">
          {STEPS.map((label, index) => {
            const done = index < current;
            const active = index === current;
            return (
              <li
                key={label}
                className="relative flex items-center"
                aria-current={active ? 'step' : undefined}
              >
                {index > 0 ? (
                  <span
                    className={cn(
                      'absolute right-1/2 top-4 h-0.5 w-full',
                      index <= current ? 'bg-accent' : 'bg-line',
                    )}
                    aria-hidden
                  />
                ) : null}
                <div className="relative z-10 flex items-center gap-2 bg-card pr-3">
                  <span
                    className={cn(
                      'grid size-8 shrink-0 place-items-center rounded-full border text-[12px] font-bold',
                      done || active
                        ? 'border-accent bg-accent text-white'
                        : 'border-line bg-surface text-ink-muted',
                    )}
                  >
                    {done ? <Check className="size-4" strokeWidth={2.4} aria-hidden /> : index + 1}
                  </span>
                  <span
                    className={cn(
                      'whitespace-nowrap text-[13px] font-semibold',
                      active ? 'text-ink' : 'text-ink-muted',
                    )}
                  >
                    {label}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
      <p className="mt-3 text-[13px] text-ink-muted">{EXPLANATION[status]}</p>
    </section>
  );
}
