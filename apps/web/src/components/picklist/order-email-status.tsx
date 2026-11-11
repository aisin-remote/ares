import { Mail } from 'lucide-react';
import { noticeResendBlock } from '@ares/domain';
import type { EmailDeliveryStatus, PicklistNoticeKind } from '@ares/contracts';
import type { getOrderEmails } from '@/lib/order-history';
import { Card, CardHeader, CardDivider, CardBody } from '@/components/ui/card';
import { cn } from '@/components/ui/cn';
import { ResendOrderEmail } from './resend-order-email';
import { waktu } from './status';

const STATUS: Record<EmailDeliveryStatus, { label: string; tone: string }> = {
  QUEUED: { label: 'Antre', tone: 'border-live/40 bg-live/10 text-live' },
  PROCESSING: { label: 'Sedang dikirim', tone: 'border-live/40 bg-live/10 text-live' },
  ACCEPTED: { label: 'Terkirim', tone: 'border-ok/40 bg-ok/10 text-ok' },
  FAILED: { label: 'Gagal', tone: 'border-ng/40 bg-ng/10 text-ng' },
  SKIPPED: { label: 'Tidak dikirim', tone: 'border-warn/40 bg-warn/10 text-warn' },
};
const KIND: Record<PicklistNoticeKind, string> = {
  PICKLIST_ISSUED: 'Order baru', PICKLIST_REVISED: 'Order recovery',
  REMINDER_NOT_DOWNLOADED: 'Pengingat unduh', REMINDER_NOT_CONFIRMED: 'Pengingat konfirmasi',
};

export function OrderEmailStatus({ reference, orderStatus, deliveries, canResend }: {
  reference: string; orderStatus: string; deliveries: Awaited<ReturnType<typeof getOrderEmails>>; canResend: boolean;
}) {
  const latest = deliveries[0];
  const blocked = noticeResendBlock(orderStatus, latest);
  return (
    <Card>
      <CardHeader icon={Mail} title="Email ke supplier" subtitle="Status pengiriman pemberitahuan order" />
      <CardDivider />
      <CardBody className="space-y-5">
        {canResend ? <ResendOrderEmail reference={reference} blocked={blocked} first={!latest} /> : null}
        {deliveries.length ? (
          <ol className="max-h-[32rem] divide-y divide-line overflow-y-auto scroll-slim" aria-label="Riwayat pengiriman email">
            {deliveries.map((delivery) => (
              <li key={delivery.id} className="space-y-2 py-4 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[14px] font-semibold">{KIND[delivery.kind]}</p>
                  <span className={cn('rounded-full border px-2.5 py-1 text-[11px] font-semibold', STATUS[delivery.status].tone)}>{STATUS[delivery.status].label}</span>
                </div>
                <p className="text-[12px] text-ink-muted">{waktu(delivery.createdAt)} WIB · {delivery.requestedBy ?? 'Otomatis ARES'} · {delivery.attempts} percobaan</p>
                <p className="break-words text-[13px] text-ink-soft">Kepada: {delivery.recipients.length ? delivery.recipients.join(', ') : 'Penerima belum tercatat'}</p>
                {delivery.cc.length ? <p className="break-words text-[12px] text-ink-muted">CC: {delivery.cc.join(', ')}</p> : null}
                {delivery.accepted.length ? <p className="break-words text-[12px] text-ok">Terkirim ke: {delivery.accepted.join(', ')}</p> : null}
                {delivery.lastError ? <p className={cn('text-[13px]', delivery.status === 'FAILED' ? 'text-ng' : 'text-ink-muted')}>{delivery.lastError}</p> : null}
                {delivery.attemptedAt ? <p className="text-[12px] text-ink-muted">Dicoba terakhir: {waktu(delivery.attemptedAt)} WIB{delivery.finishedAt ? ` · selesai ${waktu(delivery.finishedAt)} WIB` : ''}</p> : null}
              </li>
            ))}
          </ol>
        ) : <p className="text-sm text-ink-muted">Belum ada catatan pengiriman email.</p>}
      </CardBody>
    </Card>
  );
}
