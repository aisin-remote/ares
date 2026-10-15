import { AlertTriangle, ArrowRight, CalendarDays, Clock } from 'lucide-react';
import { MasterEntityPage } from '@/components/master/master-entity-page';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { getNextCutoffPreviews } from '@/lib/queries';
import { requirePermission } from '@/lib/session';

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
const day = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'Asia/Jakarta',
  weekday: 'long',
});
const shortDate = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'Asia/Jakarta',
  day: 'numeric',
  month: 'short',
});
const dateKey = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Jakarta',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function deliveryDate(value: string) {
  return date.format(new Date(`${value}T00:00:00+07:00`));
}

export default async function Page({ searchParams }: { searchParams: Promise<{ page?: string; q?: string }> }) {
  await requirePermission('setting.write');
  const previews = await getNextCutoffPreviews();
  const terjadwal = previews
    .filter((item) => item.cutoffAt && item.arrivalAt && item.deliveryDate)
    .sort((a, b) => a.cutoffAt!.getTime() - b.cutoffAt!.getTime());
  const belumTerjadwal = previews.filter((item) => !item.cutoffAt || !item.arrivalAt || !item.deliveryDate);
  const perHari = new Map<string, typeof terjadwal>();
  for (const item of terjadwal) {
    const key = dateKey.format(item.cutoffAt!);
    perHari.set(key, [...(perHari.get(key) ?? []), item]);
  }
  const cutoffPerHari = [...perHari]
    .map(([key, items]) => ({ key, date: items[0]!.cutoffAt!, items }));
  const intro = <Card className="mb-5 overflow-hidden">
    <CardHeader
      icon={CalendarDays}
      title="Kalender cutoff berikutnya"
      subtitle="Supplier dikelompokkan berdasarkan hari cutoff · waktu Asia/Jakarta"
      actions={<div className="flex flex-wrap justify-end gap-2">
        <span className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] font-semibold text-ink-soft">
          {terjadwal.length} terjadwal
        </span>
        {belumTerjadwal.length ? <span className="rounded-full border border-warn/30 bg-warn/10 px-3 py-1.5 text-[12px] font-semibold text-warn">
          {belumTerjadwal.length} perlu diisi
        </span> : null}
      </div>}
      className="flex-wrap px-5 py-4 sm:px-6"
    />
    <CardBody className="border-t border-line p-0">
      {terjadwal.length ? <div className="scroll-slim overflow-x-auto">
        <div className="grid min-w-max auto-cols-[280px] grid-flow-col divide-x divide-line">
          {cutoffPerHari.map((group) => <section key={group.key} className="w-[280px] bg-surface/20">
            <header className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-card px-4 py-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-muted">{day.format(group.date)}</p>
                <p className="mt-0.5 text-[15px] font-bold text-ink">{shortDate.format(group.date)}</p>
              </div>
              <span className="rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] font-semibold text-ink-muted">
                {group.items.length} supplier
              </span>
            </header>
            <div className="space-y-2.5 p-3">
              {group.items.map((item) => <article key={item.vendorName} className="rounded-2xl border border-line bg-card p-3.5 transition-colors hover:border-line-strong">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 text-[13px] font-bold leading-snug text-ink">{item.vendorName}</p>
                  <time dateTime={item.cutoffAt!.toISOString()} className="shrink-0 font-mono text-[18px] font-bold leading-none text-accent">
                    {clock.format(item.cutoffAt!)}
                  </time>
                </div>
                <div className="mt-3 flex items-center gap-2 border-t border-line pt-3 text-[11px] leading-tight text-ink-muted">
                  <span className="min-w-0 flex-1">
                    <span className="block uppercase tracking-wide">Kirim</span>
                    <span className="mt-1 block truncate font-semibold text-ink-soft">{deliveryDate(item.deliveryDate!)}</span>
                  </span>
                  <ArrowRight className="size-3.5 shrink-0" strokeWidth={1.8} aria-hidden />
                  <span className="min-w-0 flex-1 text-right">
                    <span className="block uppercase tracking-wide">Tiba</span>
                    <span className="mt-1 block truncate font-semibold text-ink-soft">{shortDate.format(item.arrivalAt!)} · {clock.format(item.arrivalAt!)}</span>
                  </span>
                </div>
              </article>)}
            </div>
          </section>)}
        </div>
      </div> : <p className="px-5 py-8 text-center text-[14px] text-ink-muted">Belum ada jadwal cutoff aktif. Tambahkan jadwal agar simulasi tersedia.</p>}

      {belumTerjadwal.length ? <div className="border-t border-line bg-warn/[0.035] px-5 py-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" strokeWidth={1.8} aria-hidden />
          <div className="min-w-0">
            <p className="text-[12px] font-semibold text-warn">Jadwal perlu dilengkapi</p>
            <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">
              {belumTerjadwal.map((item) => item.vendorName).join(', ')}. Lengkapi pada tabel pengaturan di bawah.
            </p>
          </div>
        </div>
      </div> : null}
    </CardBody>
  </Card>;
  return <MasterEntityPage rawEntity="vendorCutoffs" searchParams={searchParams} view={{
    path: '/settings/cutoff', section: 'Setting', title: 'Cutoff Supplier',
    description: 'Jam tutup order, waktu kedatangan, dan batas pengingat per supplier',
    listFields: ['vendorId', 'cutoffTime', 'workdays', 'leadDays', 'arrivalTime', 'downloadWarningHours', 'confirmWarningHours', 'isActive'], intro,
  }} />;
}
