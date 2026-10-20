import { notFound } from 'next/navigation';
import { ClipboardList } from 'lucide-react';
import { pcsToBoxes } from '@ares/domain';
import { getOpenOrderQueueVendorDetail } from '@/lib/queries';
import { requirePermission } from '@/lib/session';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardDivider, CardHeader } from '@/components/ui/card';
import { CutoffOrderForm } from '@/components/queue/cutoff-order-form';
import { waktu } from '@/components/picklist/status';

export const dynamic = 'force-dynamic';

export default async function CutoffOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ vendorId: string }>;
  searchParams: Promise<{ cutoff?: string | string[] }>;
}) {
  const user = await requirePermission('queue.write');
  if (user.plantId == null) notFound();
  const vendorId = Number((await params).vendorId);
  const cutoff = (await searchParams).cutoff;
  if (!Number.isSafeInteger(vendorId) || vendorId <= 0 || typeof cutoff !== 'string') notFound();
  const cutoffAt = new Date(cutoff);
  if (!Number.isFinite(cutoffAt.getTime())) notFound();
  const detail = await getOpenOrderQueueVendorDetail(vendorId, user.plantId);
  if (!detail) notFound();
  const rows = detail.rows.filter((row) => row.cutoffAt.getTime() === cutoffAt.getTime());
  if (rows.length === 0) notFound();
  const clock = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const rounding = detail.cutoffs.find(
    (item) => item.cutoffTime === `${clock.format(cutoffAt)}:00`,
  )?.rounding ?? 'FLOOR';
  const plannedRows = rows.map((row) => {
    const plan = pcsToBoxes(row.pcs + row.carryOverPcs, row.qtyPerBox, rounding);
    return {
      id: row.id,
      partNo: row.partNo,
      partName: row.partName,
      backNo: row.backNo,
      qtyPerKanban: row.qtyPerBox,
      plannedKanban: plan.boxes,
      remainingKanban: plan.carryOverPcs / row.qtyPerBox,
      equivalentKanban: (row.pcs + row.carryOverPcs) / row.qtyPerBox,
      standardKanban: row.standardKanban,
      hold: row.hold,
      blockedReason: row.blockedReason,
    };
  });

  return (
    <>
      <PageHeader
        crumbs={[
          { label: 'Antrean Order', href: '/queue' },
          { label: detail.name, href: `/queue/${vendorId}` },
          { label: 'Siapkan Order Sheet' },
        ]}
        title="Siapkan Order Sheet"
        description={`${detail.name} · cutoff ${waktu(cutoffAt)}`}
      />
      <Card>
        <CardHeader
          icon={ClipboardList}
          title="Item order"
          subtitle="Periksa jumlah kanban dan perbandingan standar, lalu simpan atau terbitkan order."
        />
        <CardDivider />
        <CutoffOrderForm
          vendorId={vendorId}
          vendorName={detail.name}
          sapVendorNo={detail.sapVendorNo}
          cutoffAt={cutoffAt.toISOString()}
          cutoffLabel={waktu(cutoffAt)}
          canRun={cutoffAt.getTime() <= Date.now()}
          rows={plannedRows}
        />
      </Card>
    </>
  );
}
