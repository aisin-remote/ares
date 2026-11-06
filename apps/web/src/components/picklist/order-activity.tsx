import { History } from 'lucide-react';
import type { OrderActivity } from '@/lib/order-history';
import { Card, CardHeader, CardBody, CardDivider } from '@/components/ui/card';
import { waktu } from './status';

/** F-54: timeline dibaca dari audit, timestamp dokumen, dan ringkasan scan aktual. */
export function OrderActivityCard({ events }: { events: OrderActivity[] }) {
  return (
    <Card>
      <CardHeader icon={History} title="Riwayat aktivitas" subtitle="Siapa melakukan apa, beserta waktunya (WIB)" />
      <CardDivider />
      <CardBody>
        {events.length ? (
          <ol className="max-h-[32rem] space-y-5 overflow-y-auto pr-2 scroll-slim" aria-label="Riwayat aktivitas order">
            {events.map((event) => (
              <li key={event.id} className="relative border-l-2 border-line pl-5">
                <span className="absolute -left-[5px] top-1.5 size-2 rounded-full bg-accent" aria-hidden />
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <p className="text-[14px] font-semibold text-ink">{event.title}</p>
                  <time dateTime={event.at.toISOString()} className="text-[12px] tabular-nums text-ink-muted">{waktu(event.at)} WIB</time>
                </div>
                <p className="mt-1 text-[13px] text-ink-soft">{event.actor}</p>
                {event.detail ? <p className="mt-1 break-words text-[13px] text-ink-muted">{event.detail}</p> : null}
                {event.eta ? <p className="mt-1 text-[13px] text-ink-muted">Perkiraan tiba: {waktu(event.eta)} WIB</p> : null}
              </li>
            ))}
          </ol>
        ) : <p className="text-sm text-ink-muted">Belum ada aktivitas tercatat untuk order ini.</p>}
      </CardBody>
    </Card>
  );
}
