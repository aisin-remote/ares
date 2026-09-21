import { ArrowRight, CalendarDays, Clock, Truck } from 'lucide-react';
import { MasterEntityPage } from '@/components/master/master-entity-page';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { getNextCutoffPreviews } from '@/lib/queries';
import { getSessionUser } from '@/lib/session';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

const date = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'Asia/Jakarta',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const clock = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'Asia/Jakarta',
  hour: '2-digit',
  minute: '2-digit',
});

function deliveryDate(value: string) {
  return date.format(new Date(`${value}T00:00:00+07:00`));
}

export default async function Page({ searchParams }: { searchParams: Promise<{ page?: string; q?: string }> }) {
  const user = await getSessionUser();
  if (user?.role !== 'ppic' && user?.role !== 'admin') notFound();
  const previews = await getNextCutoffPreviews();
  const intro = <Card className="mb-5 overflow-hidden">
    <CardHeader
      icon={Clock}
      title="Cutoff berikutnya"
      subtitle="Perkiraan jadwal order untuk setiap supplier · waktu Asia/Jakarta"
      actions={<span className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] font-semibold text-ink-soft">{previews.length} supplier</span>}
      className="px-5 py-4 sm:px-6"
    />
    <CardBody className="border-t border-line bg-surface/40 p-4 sm:p-5">
      {previews.length ? <ul className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {previews.map((item) => <li key={item.vendorName} className="rounded-card border border-line bg-card p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted">Supplier</p>
          <h3 className="mt-1 min-h-12 text-[16px] font-bold leading-6 text-ink">{item.vendorName}</h3>

          {item.cutoffAt && item.arrivalAt && item.deliveryDate ? <>
            <div className="mt-4 rounded-2xl bg-surface p-4">
              <div className="flex items-center gap-2 text-[12px] font-semibold text-ink-muted">
                <Clock className="size-4" strokeWidth={1.8} aria-hidden />
                Cutoff order
              </div>
              <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <time dateTime={item.cutoffAt.toISOString()} className="text-[15px] font-semibold text-ink-soft">
                  {date.format(item.cutoffAt)}
                </time>
                <span className="font-mono text-[24px] font-bold tracking-tight text-ink">
                  {clock.format(item.cutoffAt)}
                </span>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                  <CalendarDays className="size-3.5" strokeWidth={1.8} aria-hidden />
                  Kirim
                </div>
                <div className="mt-1 text-[13px] font-semibold leading-5 text-ink-soft">
                  {deliveryDate(item.deliveryDate)}
                </div>
              </div>
              <ArrowRight className="size-4 text-ink-muted" strokeWidth={1.8} aria-hidden />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                  <Truck className="size-3.5" strokeWidth={1.8} aria-hidden />
                  Tiba
                </div>
                <div className="mt-1 text-[13px] font-semibold leading-5 text-ink-soft">
                  {date.format(item.arrivalAt)} · {clock.format(item.arrivalAt)}
                </div>
              </div>
            </div>
          </> : <div className="mt-4 rounded-2xl border border-warn/20 bg-warn/5 px-4 py-3 text-[13px] font-semibold text-warn">{item.warning}</div>}
        </li>)}
      </ul> : <p className="rounded-2xl border border-dashed border-line px-5 py-8 text-center text-[14px] text-ink-muted">Belum ada jadwal cutoff aktif. Tambahkan jadwal agar simulasi tersedia.</p>}
    </CardBody>
  </Card>;
  return <MasterEntityPage rawEntity="vendorCutoffs" searchParams={searchParams} view={{
    path: '/settings/cutoff', section: 'Setting', title: 'Cutoff Supplier',
    description: 'Jam tutup order, hari kerja, dan waktu kedatangan per supplier',
    listFields: ['vendorId', 'cutoffTime', 'workdays', 'leadDays', 'arrivalTime', 'holidayShift', 'isActive'], intro,
  }} />;
}
