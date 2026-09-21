import { Clock } from 'lucide-react';
import { MasterEntityPage } from '@/components/master/master-entity-page';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { getNextCutoffPreviews } from '@/lib/queries';
import { getSessionUser } from '@/lib/session';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

const time = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' });

export default async function Page({ searchParams }: { searchParams: Promise<{ page?: string; q?: string }> }) {
  const user = await getSessionUser();
  if (user?.role !== 'ppic' && user?.role !== 'admin') notFound();
  const previews = await getNextCutoffPreviews();
  const intro = <Card className="mb-5">
    <CardHeader icon={Clock} title="Simulasi cutoff berikutnya" subtitle="Per supplier · waktu pabrik Asia/Jakarta" />
    <CardBody className="border-t border-line">
      {previews.length ? <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {previews.map((item) => <li key={item.vendorName} className="rounded-2xl bg-surface px-4 py-3 text-[14px]">
          <div className="font-semibold text-ink">{item.vendorName}</div>
          {item.cutoffAt && item.arrivalAt ? <>
            <div className="mt-1 text-ink-soft">Cutoff: {time.format(item.cutoffAt)}</div>
            <div className="text-ink-soft">Kirim: {item.deliveryDate} · datang {time.format(item.arrivalAt)}</div>
          </> : <div className="mt-1 font-semibold text-warn">{item.warning}</div>}
        </li>)}
      </ul> : <p className="text-[14px] text-ink-muted">Belum ada jadwal cutoff aktif. Tambahkan jadwal agar simulasi tersedia.</p>}
    </CardBody>
  </Card>;
  return <MasterEntityPage rawEntity="vendorCutoffs" searchParams={searchParams} view={{
    path: '/settings/cutoff', section: 'Setting', title: 'Cutoff Supplier',
    description: 'Jam tutup order, hari kerja, dan waktu kedatangan per supplier',
    listFields: ['vendorId', 'cutoffTime', 'workdays', 'leadDays', 'arrivalTime', 'holidayShift', 'isActive'], intro,
  }} />;
}
