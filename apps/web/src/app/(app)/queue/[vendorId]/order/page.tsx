import { notFound } from 'next/navigation';
import { ClipboardList } from 'lucide-react';
import { pcsToBoxes } from '@ares/domain';
import { getCutoffPoPreview, getOpenOrderQueueVendorDetail, listVendorPartsForOrder } from '@/lib/queries';
import { requirePermission } from '@/lib/session';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardDivider, CardHeader } from '@/components/ui/card';
import { CutoffOrderForm } from '@/components/queue/cutoff-order-form';
import { hariCutoff } from '@/components/picklist/status';

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
  const [detail, vendorPartRows, preview] = await Promise.all([
    getOpenOrderQueueVendorDetail(vendorId, user.plantId),
    listVendorPartsForOrder(vendorId),
    getCutoffPoPreview(vendorId, cutoffAt),
  ]);
  if (!detail) notFound();
  const rows = detail.rows.filter((row) => row.cutoffAt.getTime() === cutoffAt.getTime());
  if (rows.length === 0) notFound();
  const rounding = detail.cutoffs[0]?.rounding ?? 'FLOOR';
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
      po: preview.po[row.vendorPartId] ?? null,
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
        description={`${detail.name} · cutoff ${hariCutoff(cutoffAt)}`}
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
          cutoffLabel={hariCutoff(cutoffAt)}
          canRun={cutoffAt.getTime() <= Date.now()}
          delivery={preview.delivery}
          rows={plannedRows}
          extraParts={vendorPartRows
            .filter((part) => !rows.some((row) => row.vendorPartId === part.vendorPartId))
            .map((part) => ({
              vendorPartId: part.vendorPartId,
              partNo: part.partNo,
              partName: part.partName,
              backNo: part.backNo,
              qtyPerKanban: part.qtyPerBox,
              standardKanban: part.standardKanban,
              po: preview.po[part.vendorPartId] ?? null,
            }))}
        />
      </Card>
    </>
  );
}
